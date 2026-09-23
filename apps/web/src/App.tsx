import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { Accounts } from './pages/Accounts';
import { Analytics } from './pages/Analytics';
import { CalendarPage } from './pages/CalendarPage';
import { CreatePost } from './pages/CreatePost';
import { Dashboard } from './pages/Dashboard';
import { Library } from './pages/Library';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="create" element={<CreatePost />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="library" element={<Library />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
