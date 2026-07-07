import { useEffect, useState } from "react";
import logo from "./assets/images/logo.png";
import { getPeople, getTagGroups, getTags, logoutBrowserSession } from "./api";
import MobileNav from "./components/MobileNav";
import Sidebar from "./components/Sidebar";
import ExportView from "./components/ExportView";
import ImportView from "./components/ImportView";
import PeopleView from "./components/PeopleView";
import SettingsView from "./components/SettingsView";
import TagsView from "./components/TagsView";
import TimelineView from "./components/TimelineView";
import UploadView from "./components/UploadView";

const VIEW_LABELS = {
  photos: "Timeline",
  people: "People",
  tags: "Tags",
  upload: "Upload",
  export: "Export",
  import: "Import",
  settings: "Settings"
};

function LoginPage() {
  const error = new URLSearchParams(window.location.search).get("error");
  const errorMessage =
    error === "not_authorized"
      ? "Not authorized"
      : error
        ? "Sign-in failed. Try again."
        : "";

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="panel w-full max-w-md rounded-[2rem] px-8 py-10 shadow-panel">
        <div className="flex flex-col items-center text-center">
          <img src={logo} alt="AL Vault" className="h-14 w-auto" />
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-stone-950">AL Vault</h1>
          <p className="mt-3 text-sm text-stone-600">Sign in with Google to open the catalog.</p>
          {errorMessage ? (
            <div className="panel mt-6 w-full rounded-2xl border-red-300/70 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}
          <a href="/api/auth/google" className="btn-primary mt-8 w-full rounded-2xl py-3">
            Sign in with Google
          </a>
        </div>
      </div>
    </main>
  );
}

function MainApp() {
  const [currentView, setCurrentView] = useState("photos");
  const [people, setPeople] = useState([]);
  const [tags, setTags] = useState([]);
  const [tagGroups, setTagGroups] = useState([]);
  const [error, setError] = useState("");
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function refreshPeople() {
    const peopleResponse = await getPeople();
    setPeople(peopleResponse?.data || []);
  }

  async function refreshTags() {
    const tagsResponse = await getTags();
    setTags(tagsResponse?.data || []);
  }

  async function refreshTagGroups() {
    const tagGroupsResponse = await getTagGroups();
    setTagGroups(tagGroupsResponse?.data || []);
  }

  useEffect(() => {
    let isActive = true;

    async function loadReferenceData() {
      setError("");

      try {
        const [peopleResponse, tagsResponse, tagGroupsResponse] = await Promise.all([
          getPeople(),
          getTags(),
          getTagGroups()
        ]);

        if (!isActive) {
          return;
        }

        setPeople(peopleResponse?.data || []);
        setTags(tagsResponse?.data || []);
        setTagGroups(tagGroupsResponse?.data || []);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError.message || "Failed to load app data");
      }
    }

    loadReferenceData();

    return () => {
      isActive = false;
    };
  }, []);

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    try {
      await logoutBrowserSession();
    } catch {}

    window.location.assign("/login");
  }

  return (
    <div className="h-screen overflow-hidden text-stone-900">
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />
      <MobileNav currentView={currentView} onNavigate={setCurrentView} />

      <main className="h-screen overflow-hidden lg:pl-[240px]">
        <div className="mx-auto flex h-screen w-full max-w-[1800px] flex-col overflow-hidden px-6 py-6 pb-16 lg:pb-0 2xl:px-8">
          <div className="mb-4 flex items-center justify-end">
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="btn-secondary rounded-2xl"
            >
              {isLoggingOut ? "Signing out..." : "Logout"}
            </button>
          </div>

          {error ? (
            <div className="panel mb-4 border-red-300/70 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {currentView === "export" || currentView === "import" || currentView === "settings" ? (
            <div className="mb-4">
              <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
                {VIEW_LABELS[currentView]}
              </p>
            </div>
          ) : null}

          {currentView === "photos" ? (
            <TimelineView people={people} tags={tags} tagGroups={tagGroups} />
          ) : currentView === "people" ? (
            <PeopleView people={people} refreshPeople={refreshPeople} />
          ) : currentView === "tags" ? (
            <TagsView
              tagGroups={tagGroups}
              refreshTags={refreshTags}
              refreshTagGroups={refreshTagGroups}
            />
          ) : currentView === "upload" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <UploadView onNavigate={setCurrentView} />
            </div>
          ) : currentView === "settings" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <SettingsView />
            </div>
          ) : currentView === "import" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ImportView />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ExportView people={people} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return window.location.pathname === "/login" ? <LoginPage /> : <MainApp />;
}
