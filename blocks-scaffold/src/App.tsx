import { useEffect, useState } from 'react';
import { authApi } from 'aws-blocks';
import { onAuthChange } from '@aws-blocks/blocks/ui';
import { ReactAuthenticator } from './components/ReactAuthenticator';
import { UserHeader } from './components/UserHeader';
import { BookmarkForm } from './components/BookmarkForm';
import { BookmarkList } from './components/BookmarkList';

interface User {
  username: string;
  userId: string;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    // onAuthChange automatically calls back on register, login, signout, and mount.
    return onAuthChange(authApi, (u) => {
      setUser(u as User | null);
    });
  }, []);

  const triggerReload = () => {
    setReloadTrigger((prev) => prev + 1);
  };

  const handleSignOut = async () => {
    try {
      await authApi.setAuthState({ action: 'signOut' });
    } catch (err) {
      console.error('Failed to sign out:', err);
    }
  };

  if (!user) {
    return (
      <div className="auth-container">
        <h1 className="app-title" style={{ textAlign: 'center', marginTop: '4rem', marginBottom: '2rem' }}>
          Bookmark Manager
        </h1>
        <ReactAuthenticator authApi={authApi} />
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-title-bar">
        <h1 className="app-title">Bookmark Manager</h1>
        <UserHeader username={user.username} onSignOut={handleSignOut} />
      </header>

      <main className="dashboard-grid">
        <aside>
          <BookmarkForm onBookmarkCreated={triggerReload} />
        </aside>
        
        <section className="glass-card" style={{ flex: 1 }}>
          <h3 className="card-title">My Bookmarks</h3>
          <BookmarkList reloadTrigger={reloadTrigger} onDeleted={triggerReload} />
        </section>
      </main>
    </div>
  );
}
