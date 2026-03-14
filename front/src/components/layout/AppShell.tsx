import { NavLink, Outlet } from 'react-router-dom';

export default function AppShell() {
    return (
        <div className="app-shell">
            <aside className="app-sidebar">
                <div className="sidebar-logo">🎙️ Support Agent</div>
                <nav className="sidebar-nav">
                    <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        💬 Chat & Voice
                    </NavLink>
                    <NavLink to="/email" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        📧 Email Support
                    </NavLink>
                    <NavLink to="/admin" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        🎫 Tickets
                    </NavLink>
                    <NavLink to="/kb" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        📚 Knowledge Base
                    </NavLink>
                    <NavLink to="/tests" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} style={{ marginTop: 'auto', borderTop: '1px solid var(--border)' }}>
                        🧪 Test Questions
                    </NavLink>
                </nav>
                <div style={{ padding: '16px 20px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    Support Desk AI v2.0
                </div>
            </aside>

            <header className="app-header">
                <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Support Desk AI Agent</h2>
            </header>

            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
