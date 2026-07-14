import { useMemo, useState } from "react";
import { NAV_ITEMS } from "../navItems";

const PRIMARY_TAB_IDS = ["photos", "upload", "tags", "import"];

function getItemClasses(isActive) {
  return isActive
    ? "bg-stone-900 text-stone-50"
    : "text-stone-700 hover:bg-white hover:text-stone-900";
}

export default function MobileNav({ currentView, onNavigate }) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const primaryItems = useMemo(
    () => NAV_ITEMS.filter((item) => PRIMARY_TAB_IDS.includes(item.id)),
    []
  );
  const moreItems = useMemo(
    () => NAV_ITEMS.filter((item) => !PRIMARY_TAB_IDS.includes(item.id)),
    []
  );
  const isMoreActive = moreItems.some((item) => item.id === currentView);

  function handleNavigate(viewId) {
    onNavigate(viewId);
    setIsMoreOpen(false);
  }

  return (
    <>
      {isMoreOpen ? (
        <div
          className="fixed inset-0 z-40 bg-stone-950/30 lg:hidden"
          onClick={() => setIsMoreOpen(false)}
        >
          <div
            className="absolute inset-x-4 bottom-24 rounded-[1.75rem] border border-stone-300/80 bg-stone-50 p-3 shadow-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-2">
              {moreItems.map((item) => {
                const isActive = item.id === currentView;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                      getItemClasses(isActive)
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-stone-300/80 bg-stone-50/95 px-3 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur lg:hidden">
        <div className="grid grid-cols-5 gap-2">
          {primaryItems.map((item) => {
            const isActive = item.id === currentView;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`flex min-h-[56px] flex-col items-center justify-center rounded-2xl px-2 py-2 text-center text-xs font-medium transition ${
                  getItemClasses(isActive)
                }`}
              >
                <i className={`${item.icon} text-base leading-none`} aria-hidden="true" />
                <span className="mt-1">{item.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setIsMoreOpen((currentValue) => !currentValue)}
            className={`flex min-h-[56px] flex-col items-center justify-center rounded-2xl px-2 py-2 text-center text-xs font-medium transition ${
              getItemClasses(isMoreActive || isMoreOpen)
            }`}
          >
            <span className="text-base leading-none" aria-hidden="true">
              …
            </span>
            <span className="mt-1">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
