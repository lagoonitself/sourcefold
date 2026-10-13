import React, { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { getSettings } from '../../lib/settings';
import { detectPageType, type PageType } from '../../lib/page-type';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [pageType, setPageType] = useState<PageType>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const settings = await getSettings();
        const tokenPresent = Boolean(settings.token && settings.token.trim().length > 0);
        setHasToken(tokenPresent);

        if (tokenPresent) {
          const tabs = await browser.tabs.query({ active: true, currentWindow: true });
          const activeTab = tabs[0];
          if (activeTab) {
            setPageTitle(activeTab.title || activeTab.url || '');
            setPageType(detectPageType(activeTab.url));
          }
        }
      } catch (err) {
        console.error('Failed to load extension popup state', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const openSettings = () => {
    browser.runtime.openOptionsPage();
  };

  const getDetectedTypeLabel = (type: PageType): string => {
    switch (type) {
      case 'grokipedia':
        return 'Grokipedia article';
      case 'substack':
        return 'Substack post';
      case 'x':
        return 'X post';
      default:
        return "This page can't be saved yet. Open a Grokipedia article, a Substack post or an X post.";
    }
  };

  if (loading) {
    return <div className="popup-container" />;
  }

  return (
    <div className="popup-container">
      <div className="popup-header">
        <h1 className="popup-header-title">Sourcefold</h1>
        <button
          type="button"
          className="btn-icon"
          onClick={openSettings}
          title="Settings"
          aria-label="Settings"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      {!hasToken ? (
        <div className="popup-main">
          <p className="popup-connect-text">Connect the extension to your Sourcefold app.</p>
          <div className="popup-actions">
            <button type="button" className="btn-primary" onClick={openSettings}>
              Open settings
            </button>
          </div>
        </div>
      ) : (
        <div className="popup-main">
          <h2 className="popup-page-title">{pageTitle || 'Untitled page'}</h2>
          <p className="popup-detected-type">{getDetectedTypeLabel(pageType)}</p>
          <select className="popup-select" disabled value="">
            <option value="">Folders load in the next version</option>
          </select>
          <div className="popup-actions">
            <button type="button" className="btn-primary" disabled>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
