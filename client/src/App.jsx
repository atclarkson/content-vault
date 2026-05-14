import { useEffect, useState } from "react";
import { getPeople, getTags } from "./api";
import Sidebar from "./components/Sidebar";
import ExportView from "./components/ExportView";
import PhotosView from "./components/PhotosView";
import UploadView from "./components/UploadView";

const VIEWS = [
  { id: "photos", label: "Photos" },
  { id: "upload", label: "Upload" },
  { id: "export", label: "Export" }
];

export default function App() {
  const [currentView, setCurrentView] = useState("photos");
  const [people, setPeople] = useState([]);
  const [tags, setTags] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadReferenceData() {
      setIsLoading(true);
      setError("");

      try {
        const [peopleResponse, tagsResponse] = await Promise.all([getPeople(), getTags()]);

        if (!isActive) {
          return;
        }

        setPeople(peopleResponse?.data || []);
        setTags(tagsResponse?.data || []);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError.message || "Failed to load app data");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadReferenceData();

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <div className="min-h-screen text-stone-900">
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />

      <main className="min-h-screen pl-[240px]">
        <div className="mx-auto flex min-h-screen w-full max-w-[1800px] flex-col px-8 py-8 2xl:px-12">
          <header className="mb-8 flex items-start justify-between gap-6 border-b border-stone-300/80 pb-6">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-stone-500">Personal Catalog</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">
                {VIEWS.find((view) => view.id === currentView)?.label || "content-vault"}
              </h1>
            </div>

            <div className="flex gap-3">
              <div className="panel px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.25em] text-stone-500">People</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">{people.length}</p>
              </div>
              <div className="panel px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.25em] text-stone-500">Tags</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">{tags.length}</p>
              </div>
            </div>
          </header>

          {error ? (
            <div className="panel mb-6 border-red-300/70 bg-red-50 px-5 py-4 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {currentView === "photos" ? (
            <PhotosView people={people} tags={tags} />
          ) : currentView === "upload" ? (
            <UploadView onNavigate={setCurrentView} />
          ) : (
            <ExportView />
          )}
        </div>
      </main>
    </div>
  );
}
