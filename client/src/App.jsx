import { useEffect, useState } from "react";
import { getPeople, getTags } from "./api";
import Sidebar from "./components/Sidebar";
import ExportView from "./components/ExportView";
import PhotosView from "./components/PhotosView";
import UploadView from "./components/UploadView";

export default function App() {
  const [currentView, setCurrentView] = useState("photos");
  const [people, setPeople] = useState([]);
  const [tags, setTags] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadReferenceData() {
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
      }
    }

    loadReferenceData();

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <div className="h-screen overflow-hidden text-stone-900">
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />

      <main className="h-screen overflow-hidden pl-[240px]">
        <div className="mx-auto flex h-screen w-full max-w-[1800px] flex-col overflow-hidden px-6 py-6 2xl:px-8">
          {error ? (
            <div className="panel mb-4 border-red-300/70 bg-red-50 px-4 py-3 text-sm text-red-700">
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
