import { useEffect, useRef, useState } from "react";
import { getSettings, updateSetting } from "../api";

export default function SettingsView() {
  const [captionBio, setCaptionBio] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState("");
  const lastSavedValueRef = useRef("");
  const saveTimeoutRef = useRef(null);
  const savedIndicatorTimeoutRef = useRef(null);

  useEffect(() => {
    let isActive = true;

    async function loadSettings() {
      setIsLoading(true);
      setError("");

      try {
        const response = await getSettings();
        const settings = response?.data || {};
        const nextCaptionBio = settings.caption_bio || "";

        if (!isActive) {
          return;
        }

        setCaptionBio(nextCaptionBio);
        lastSavedValueRef.current = nextCaptionBio;
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError.message || "Failed to load settings");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadSettings();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (isLoading) {
      return undefined;
    }

    if (captionBio === lastSavedValueRef.current) {
      return undefined;
    }

    setSaveState("dirty");

    saveTimeoutRef.current = window.setTimeout(async () => {
      setIsSaving(true);
      setError("");

      try {
        await updateSetting("caption_bio", captionBio);
        lastSavedValueRef.current = captionBio;
        setSaveState("saved");

        window.clearTimeout(savedIndicatorTimeoutRef.current);
        savedIndicatorTimeoutRef.current = window.setTimeout(() => {
          setSaveState("idle");
        }, 1600);
      } catch (saveError) {
        setError(saveError.message || "Failed to save settings");
        setSaveState("error");
      } finally {
        setIsSaving(false);
      }
    }, 1500);

    return () => {
      window.clearTimeout(saveTimeoutRef.current);
    };
  }, [captionBio, isLoading]);

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimeoutRef.current);
      window.clearTimeout(savedIndicatorTimeoutRef.current);
    };
  }, []);

  return (
    <section className="panel p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Settings</p>
        <h2 className="mt-2 text-2xl font-semibold text-stone-900">Caption settings</h2>
      </div>

      {error ? (
        <div className="mb-6 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="border border-stone-300 bg-stone-50 p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Caption Bio</p>
            <h3 className="mt-2 text-lg font-medium text-stone-900">Who You Are</h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
              This is sent to Claude on every caption call. Include who your family is, travel context, and any background that helps AI write better captions.
            </p>
          </div>

          <div className="shrink-0 text-sm text-stone-500">
            {isSaving ? "Saving..." : saveState === "saved" ? "Saved" : null}
          </div>
        </div>

        <textarea
          value={captionBio}
          onChange={(event) => setCaptionBio(event.target.value)}
          rows={10}
          className="field min-h-[240px] resize-y"
          placeholder={isLoading ? "Loading settings..." : "Describe your family, travel style, writing voice, and any context Claude should know."}
          disabled={isLoading}
        />
      </section>
    </section>
  );
}
