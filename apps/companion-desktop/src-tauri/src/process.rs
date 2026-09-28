use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

pub fn resolve(name: &str, custom: &str) -> Result<PathBuf, String> {
    if !custom.trim().is_empty() {
        let p = PathBuf::from(custom.trim());
        if !p.is_absolute() || !p.is_file() {
            return Err("Choose an absolute path to an installed CLI executable.".into());
        }
        return native(p);
    }
    let mut folders: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|s| std::env::split_paths(&s).collect())
        .unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        for suffix in [
            ".local/bin",
            ".cargo/bin",
            ".npm-global/bin",
            ".antigravity/antigravity/bin",
            "AppData/Local/Microsoft/WinGet/Links",
        ] {
            folders.push(home.join(suffix));
        }
    }
    folders.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    for folder in folders {
        let p = folder.join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.into()
        });
        if p.is_file() {
            return native(p);
        }
    }
    Err(format!(
        "{name} was not found. Install it or set its executable path below."
    ))
}
fn native(p: PathBuf) -> Result<PathBuf, String> {
    if cfg!(windows)
        && p.extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("exe"))
            != Some(true)
    {
        return Err("Choose the native .exe, not a .cmd or .bat wrapper.".into());
    }
    Ok(p)
}

#[cfg(windows)]
struct JobGuard(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl JobGuard {
    fn new(child: &std::process::Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("Cannot create process isolation job.".into());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
                || AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0
            {
                CloseHandle(job);
                return Err("Cannot isolate CLI process tree.".into());
            }
            Ok(Self(job))
        }
    }
}
#[cfg(windows)]
impl Drop for JobGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

// Data is never interpolated into a shell. A process group/job contains descendants.
pub fn run(
    bin: &Path,
    args: &[String],
    input: &str,
    cwd: &Path,
    timeout: Duration,
    cancel: &AtomicBool,
    stderr_output: bool,
) -> Result<String, String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("Cancelled".into());
    }
    let mut command = Command::new(bin);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| {
        "CLI could not start. Check the executable path and permissions.".to_string()
    })?;
    #[cfg(windows)]
    let guard = match JobGuard::new(&child) {
        Ok(g) => g,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    };
    #[cfg(unix)]
    let pid = child.id();
    let (tx, rx) = mpsc::sync_channel(16);
    for (mut reader, is_err) in [
        (
            Box::new(child.stdout.take().unwrap()) as Box<dyn Read + Send>,
            false,
        ),
        (
            Box::new(child.stderr.take().unwrap()) as Box<dyn Read + Send>,
            true,
        ),
    ] {
        let tx = tx.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send((is_err, buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }
    drop(tx);
    let mut stdin = child.stdin.take().unwrap();
    let input = input.as_bytes().to_vec();
    let writer = thread::spawn(move || stdin.write_all(&input));
    let started = Instant::now();
    let mut output = Vec::new();
    let mut size = 0;
    let mut failure = None;
    let mut status = None;
    loop {
        if cancel.load(Ordering::SeqCst) {
            failure = Some("Cancelled".to_string());
            break;
        }
        if started.elapsed() > timeout {
            failure = Some("CLI timed out".to_string());
            break;
        }
        match rx.recv_timeout(Duration::from_millis(40)) {
            Ok((err, chunk)) => {
                size += chunk.len();
                if size > 512_000 {
                    failure = Some("CLI output limit exceeded".into());
                    break;
                }
                if !err || stderr_output {
                    output.extend(chunk);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if status.is_some() {
                    break;
                }
                thread::sleep(Duration::from_millis(40));
            }
            Err(_) => {}
        }
        if status.is_none() {
            match child.try_wait() {
                Ok(s) => status = s,
                Err(_) => {
                    failure = Some("CLI process failed".into());
                    break;
                }
            }
        }
        if status.is_some() {
            // Close descendants holding inherited pipes, then drain remaining bounded output.
            #[cfg(unix)]
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
            #[cfg(windows)]
            unsafe {
                windows_sys::Win32::System::JobObjects::TerminateJobObject(guard.0, 1);
            }
        }
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    drop(guard);
    let _ = child.kill();
    let exit = child.wait();
    drop(rx);
    let written = writer.join();
    if let Some(error) = failure {
        return Err(error);
    }
    if !matches!(written, Ok(Ok(()))) {
        return Err("CLI input failed".into());
    }
    if !status.or_else(|| exit.ok()).is_some_and(|s| s.success()) {
        return Err("CLI failed. Check sign-in, model access, and account limits.".into());
    }
    String::from_utf8(output).map_err(|_| "CLI returned invalid text".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_relative_override() {
        assert!(resolve("codex", "some/path").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn input_is_literal() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            run(
                Path::new("/bin/cat"),
                &[],
                "$(echo secret)",
                dir.path(),
                Duration::from_secs(2),
                &AtomicBool::new(false),
                false
            )
            .unwrap(),
            "$(echo secret)"
        );
    }
    #[cfg(unix)]
    #[test]
    fn timeout_kills_tree() {
        let dir = tempfile::tempdir().unwrap();
        assert!(run(
            Path::new("/bin/sleep"),
            &["20".into()],
            "",
            dir.path(),
            Duration::from_millis(100),
            &AtomicBool::new(false),
            false
        )
        .unwrap_err()
        .contains("timed out"));
    }
    #[test]
    fn cancellation_prevents_spawn() {
        assert_eq!(
            run(
                Path::new("missing"),
                &[],
                "",
                Path::new("."),
                Duration::from_secs(1),
                &AtomicBool::new(true),
                false
            )
            .unwrap_err(),
            "Cancelled"
        );
    }
}

#[cfg(all(test, unix))]
mod limits_tests {
    use super::*;
    #[test]
    fn output_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        assert!(run(
            Path::new("/usr/bin/yes"),
            &[],
            "",
            dir.path(),
            Duration::from_secs(3),
            &AtomicBool::new(false),
            false
        )
        .unwrap_err()
        .contains("output limit"));
    }
    #[test]
    fn descendants_cannot_keep_pipes_open() {
        let dir = tempfile::tempdir().unwrap();
        let start = Instant::now();
        let result = run(
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 20 & printf finished".into()],
            "",
            dir.path(),
            Duration::from_secs(3),
            &AtomicBool::new(false),
            false,
        )
        .unwrap();
        assert_eq!(result, "finished");
        assert!(start.elapsed() < Duration::from_secs(3));
    }
}
