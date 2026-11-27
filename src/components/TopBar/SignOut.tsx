import React, { useEffect, useState } from 'react';
import { AnchorButton } from '@blueprintjs/core';

import css from './styles.scss';

// oauth2-proxy answers these when it runs in front of the UI; without it the
// request returns the page or an error, and nothing shows. Relative, so they
// follow <base href> (hubble.ui.baseUrl): run oauth2-proxy with
// --proxy-prefix=<baseUrl>oauth2.
const userInfoURL = 'oauth2/userinfo';
const signOutURL = () => {
  // Back to the UI after signing out, not to the site root.
  const home = new URL('.', document.baseURI).pathname;
  return `oauth2/sign_out?rd=${encodeURIComponent(home)}`;
};

export function SignOut() {
  const [who, setWho] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(userInfoURL, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(info => {
        const name = info?.email ?? info?.preferredUsername ?? info?.user;
        if (live && typeof name === 'string') setWho(name);
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, []);

  if (who == null) return null;

  return (
    <div className={css.signOut}>
      <span className={css.user} title={who}>
        {who}
      </span>
      <AnchorButton minimal small icon="log-out" href={signOutURL()} text="Sign out" />
    </div>
  );
}
