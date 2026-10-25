import React, { useEffect, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { NAV_ITEMS, OVERFLOW_ITEMS } from './navigation.js';
const mobileItems = [...NAV_ITEMS, { id: 'more', label: 'More', icon: Ellipsis }];
const moreItems = OVERFLOW_ITEMS;

const moreIds = moreItems.map((item) => item.id);

export function MobileNavigation({ active, onNavigate }) {
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!moreOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMoreOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [moreOpen]);

  function navigate(id) {
    setMoreOpen(false);
    onNavigate(id);
  }

  return (
    <>
      {moreOpen ? (
        <>
          <div className="mobile-sheet-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
          <div className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More navigation">
            {moreItems.map((item) => (
              <button key={item.id} type="button" className={active === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>
                <item.icon size={18} aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <nav className="mobile-navigation" aria-label="Mobile navigation">
        {mobileItems.map((item) => {
          const isMore = item.id === 'more';
          const isActive = isMore ? moreIds.includes(active) : active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={isActive ? 'active' : ''}
              aria-expanded={isMore ? moreOpen : undefined}
              onClick={() => (isMore ? setMoreOpen((value) => !value) : navigate(item.id))}
            >
              <item.icon size={18} aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
