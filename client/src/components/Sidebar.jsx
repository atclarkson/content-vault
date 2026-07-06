import logo from "../assets/images/logo.png";
import { NAV_ITEMS } from "../navItems";

export default function Sidebar({ currentView, onNavigate }) {
  return (
    <aside className="fixed left-0 top-0 hidden h-screen w-[240px] flex-col border-r border-cyan-900/10 bg-white/90 px-5 py-6 backdrop-blur lg:flex">
      <div className="border-b border-stone-300/80 pb-6">
        <img src={logo} alt="AL Vault" className="h-10 w-auto" />
      </div>

      <nav className="mt-6 flex flex-col gap-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === currentView;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                isActive
                  ? "bg-stone-900 text-stone-50"
                  : "text-stone-700 hover:bg-white hover:text-stone-900"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
