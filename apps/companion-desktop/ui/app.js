const invoke = window.__TAURI__.core.invoke;
const $ = (id) => document.getElementById(id);
let working = false, initializedPaths = false;
async function action(name, args) {
  if (working) return;
  working = true; $('error').hidden = true;
  try { await invoke(name, args); if (name === 'pair') $('code').value = ''; if (name === 'forget') initializedPaths = false; }
  catch (error) { $('error').textContent = String(error); $('error').hidden = false; }
  finally { working = false; await refresh(); }
}
$('pair-form').addEventListener('submit', e => { e.preventDefault(); void action('pair', {origin:$('origin').value, code:$('code').value, name:$('name').value}); });
$('start').addEventListener('click', () => void action('start'));
$('pause').addEventListener('click', () => void action('pause'));
$('forget').addEventListener('click', () => { $('forget-confirm').hidden=false; });
$('forget-no').addEventListener('click', () => { $('forget-confirm').hidden=true; });
$('forget-yes').addEventListener('click', () => { $('forget-confirm').hidden=true; void action('forget'); });
$('paths-form').addEventListener('submit', e => {e.preventDefault();void action('save_paths',{paths:{codex:$('codex-path').value.trim(),antigravity:$('agy-path').value.trim()}});});
async function refresh() {
  try {
    const s = await invoke('status');
    $('pairing').hidden = s.paired; $('paired').hidden = !s.paired;
    $('connection').textContent = s.running ? (s.busy ? 'Generating' : 'Companion running') : (s.paired ? 'Paused' : 'Not paired');
    $('indicator').className = s.running ? 'online' : '';
    $('message').textContent = s.message; $('workspace').textContent = s.origin;
    $('start').disabled = working || s.running; $('pause').disabled = working || !s.running;
    $('forget').disabled = working || s.running || s.busy;
    $('paths-form').querySelector('button').disabled = working || !s.paired || s.running || s.busy;
    if (!initializedPaths && s.paired) { $('codex-path').value=s.paths.codex; $('agy-path').value=s.paths.antigravity; initializedPaths=true; }
    if (Object.keys(s.capabilities).length) {
      const nodes = Object.entries(s.capabilities).map(([name,c]) => {
        const card=document.createElement('article');const title=document.createElement('strong');title.textContent=name==='codex'?'Codex':'Antigravity';
        const badge=document.createElement('span');badge.className=c.ready?'badge ready':'badge';badge.textContent=c.ready?'Ready':(c.installed?'Needs attention':'Not found');
        const detail=document.createElement('p');detail.textContent=c.detail;const version=document.createElement('small');version.textContent=c.version;
        card.append(title,badge,detail,version);return card;
      });$('providers').replaceChildren(...nodes);
    }
  } catch { $('message').textContent = 'Cannot communicate with the companion.'; }
}
void refresh(); setInterval(() => {if(!working)void refresh();},1500);
