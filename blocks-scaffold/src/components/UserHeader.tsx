interface UserHeaderProps {
  username: string;
  onSignOut: () => void;
}

export function UserHeader({ username, onSignOut }: UserHeaderProps) {
  return (
    <div className="user-header">
      <span className="username">👤 {username}</span>
      <button className="btn-signout" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
