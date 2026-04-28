import type { Preview } from '@storybook/react-vite';
import React from 'react';
import '../styles.css';
import './preview-obsidian-vars.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: {
      options: {
        "obsidian-light": { name: 'obsidian-light', value: '#ffffff' },
        "obsidian-dark": { name: 'obsidian-dark', value: '#202020' }
      }
    },
    controls: { expanded: true },
  },

  decorators: [
    (Story, context) => {
      const bg = (context.globals?.backgrounds as { value?: string } | undefined)?.value;
      const theme = bg === 'obsidian-dark' ? 'dark' : 'light';
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme);
      }
      return React.createElement(
        'div',
        {
          className: 'leo-chat',
          'data-theme': theme,
          style: { padding: 12, maxWidth: 520 },
        },
        React.createElement(Story),
      );
    },
  ],

  initialGlobals: {
    backgrounds: {
      value: 'obsidian-light'
    }
  }
};

export default preview;
