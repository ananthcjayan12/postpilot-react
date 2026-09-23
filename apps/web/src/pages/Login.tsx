import { ArrowRight, CheckCircle2, Facebook, Instagram, Youtube } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';

export function Login() {
  const navigate = useNavigate();
  const enter = () => {
    localStorage.setItem('postpilot-local-session', '1');
    navigate('/');
  };
  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="login-hero">
          <div className="login-brand"><Logo /></div>
          <div className="hero-copy">
            <span className="eyebrow light">MULTI-PLATFORM CREATOR STUDIO</span>
            <h1>Your videos.<br />Everywhere they belong.</h1>
            <p>Upload once. Publish or schedule to YouTube, Instagram and Facebook from one focused workspace.</p>
            <div className="hero-platforms"><span><Youtube /> YouTube</span><span><Instagram /> Instagram</span><span><Facebook /> Facebook</span></div>
          </div>
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-float-card one"><strong>Scheduled</strong><span>Japan travel vlog · 10:00 AM</span></div>
          <div className="hero-float-card two"><strong>3 platforms</strong><span>One upload, one workflow</span></div>
        </section>
        <section className="login-panel">
          <div className="login-form-card">
            <span className="eyebrow">LOCAL-FIRST · FREE</span>
            <h2>Welcome back 👋</h2>
            <p>Enter your local PostPilot workspace. Platform authorization happens separately in Connected Accounts.</p>
            <label>Email</label>
            <input className="input" defaultValue="creator@postpilot.local" />
            <label>Workspace</label>
            <div className="input fake-input">PostPilot Creator Studio</div>
            <button className="btn primary large" onClick={enter}>Enter Studio <ArrowRight size={18} /></button>
            <div className="login-notes">
              <div><CheckCircle2 size={17} /> No paid scheduler</div>
              <div><CheckCircle2 size={17} /> OAuth tokens stay on your machine</div>
              <div><CheckCircle2 size={17} /> Official YouTube + Meta APIs</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
