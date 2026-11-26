import React from 'react';

// clickable gives a non-button element what a button has: focus by Tab,
// Enter and Space to click, and the button role for screen readers.
export const clickable = (onClick?: () => void) =>
  onClick == null
    ? {}
    : {
        role: 'button',
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;

          e.preventDefault();
          onClick();
        },
      };
