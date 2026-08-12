import { useEffect, useRef } from 'react';
import { Authenticator } from '@aws-blocks/blocks/ui';

interface ReactAuthenticatorProps {
  authApi: any;
}

export function ReactAuthenticator({ authApi }: ReactAuthenticatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(Authenticator(authApi));
    }
  }, [authApi]);

  return (
    <div className="auth-wrapper">
      <div ref={containerRef} />
    </div>
  );
}
