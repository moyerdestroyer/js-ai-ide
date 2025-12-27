import { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import "./App.css";
import {
  registerAICompletionProvider,
  preloadModel,
  setProgressCallback,
  getLoadingState,
} from "./aiCompletionProvider";

function App() {
  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [theme, setTheme] = useState("vs-dark");
  const [fontFamily, setFontFamily] = useState(
    'Consolas, "Courier New", monospace'
  );
  const [fontSize, setFontSize] = useState(14);
  const [modelLoadingProgress, setModelLoadingProgress] = useState(0);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isGeneratingCompletion, setIsGeneratingCompletion] = useState(false);
  const editorRef = useRef(null);
  const completionTimeoutRef = useRef(null);
  const monacoRef = useRef(null);
  const providerRegisteredRef = useRef(false);

  // Load files from localStorage on mount
  useEffect(() => {
    const savedFiles = localStorage.getItem("ide-files");
    if (savedFiles) {
      const parsedFiles = JSON.parse(savedFiles);
      setFiles(parsedFiles);
      if (parsedFiles.length > 0) {
        setActiveFileId(parsedFiles[0].id);
      }
    } else {
      // Create default file if no files exist
      const defaultFile = {
        id: Date.now().toString(),
        name: "main.js",
        content:
          '// Welcome to your JavaScript IDE\nconsole.log("Hello, World!");\n',
      };
      setFiles([defaultFile]);
      setActiveFileId(defaultFile.id);
    }
  }, []);

  // Preload AI model on mount
  useEffect(() => {
    // Set up progress callback with proper React state batching
    setProgressCallback((progress, generating) => {
      // Use requestAnimationFrame to ensure state updates don't block UI
      requestAnimationFrame(() => {
        if (generating !== undefined) {
          // This is a completion generation signal
          // Clear any existing timeout
          if (completionTimeoutRef.current) {
            clearTimeout(completionTimeoutRef.current);
            completionTimeoutRef.current = null;
          }

          if (generating) {
            // Show spinner immediately - no delay needed
            setIsGeneratingCompletion(true);
          } else {
            // Hide spinner after a small delay to avoid flicker if generation is very fast
            completionTimeoutRef.current = setTimeout(() => {
              setIsGeneratingCompletion(false);
              completionTimeoutRef.current = null;
            }, 150);
          }
        } else if (progress !== null && progress !== undefined) {
          // This is model loading progress
          setModelLoadingProgress(progress);
          setIsModelLoading(progress < 100);
          setIsModelLoaded(progress === 100);
        }
      });
    });

    // Start preloading the model
    const state = getLoadingState();
    if (!state.isLoaded && !state.isLoading) {
      setIsModelLoading(true);
      // Use setTimeout to yield to browser before starting heavy operation
      setTimeout(() => {
        preloadModel().then(() => {
          const newState = getLoadingState();
          setIsModelLoading(newState.isLoading);
          setIsModelLoaded(newState.isLoaded);
          setModelLoadingProgress(newState.progress);
        });
      }, 0);
    } else {
      // Model is already loading or loaded
      setIsModelLoading(state.isLoading);
      setIsModelLoaded(state.isLoaded);
      setModelLoadingProgress(state.progress);
    }

    // Cleanup timeout on unmount
    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
    };
  }, []);

  // Auto-save files to localStorage whenever they change
  useEffect(() => {
    if (files.length > 0) {
      localStorage.setItem("ide-files", JSON.stringify(files));
    }
  }, [files]);

  const activeFile = files.find((f) => f.id === activeFileId);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // Configure Monaco for JavaScript (safe to call multiple times)
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: "React",
      allowJs: true,
      typeRoots: ["node_modules/@types"],
    });
    
    // Register AI provider only once, even if editor remounts
    if (!providerRegisteredRef.current) {
      registerAICompletionProvider(monaco);
      providerRegisteredRef.current = true;
    }
  };

  const handleEditorChange = (value) => {
    if (activeFileId) {
      setFiles((prevFiles) =>
        prevFiles.map((file) =>
          file.id === activeFileId ? { ...file, content: value || "" } : file
        )
      );
    }
  };

  const createNewFile = () => {
    const newFile = {
      id: Date.now().toString(),
      name: `file${files.length + 1}.js`,
      content: "",
    };
    setFiles((prevFiles) => [...prevFiles, newFile]);
    setActiveFileId(newFile.id);
  };

  const deleteFile = (fileId) => {
    if (files.length === 1) {
      alert("Cannot delete the last file. Create a new file first.");
      return;
    }
    const newFiles = files.filter((f) => f.id !== fileId);
    setFiles(newFiles);
    if (activeFileId === fileId) {
      setActiveFileId(newFiles[0].id);
    }
  };

  const renameFile = (fileId, newName, enforceExtension = false) => {
    // Strip any existing .js extension first to avoid duplicates
    let nameWithoutExt = newName.endsWith(".js")
      ? newName.slice(0, -3)
      : newName;

    // Only enforce .js extension if requested (on blur)
    // While typing, allow the name without extension
    const name = enforceExtension ? `${nameWithoutExt}.js` : nameWithoutExt;

    setFiles((prevFiles) =>
      prevFiles.map((file) => (file.id === fileId ? { ...file, name } : file))
    );
  };

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === "vs-dark" ? "vs" : "vs-dark"));
  };

  return (
    <div className="ide-container">
      <div className="ide-header">
        <div className="ide-title-container">
          <div className="ide-title">JavaScript IDE</div>
          {isModelLoading && (
            <div className="model-loading-indicator">
              <span className="loading-text">
                Loading AI model... {modelLoadingProgress}%
              </span>
            </div>
          )}
          {isModelLoaded && isGeneratingCompletion && (
            <div
              className="completion-loading-indicator"
              title="Generating code completion..."
            >
              <span className="spinner"></span>
            </div>
          )}
        </div>
        <div className="ide-controls">
          <button onClick={createNewFile} className="btn btn-primary">
            + New File
          </button>
          <div className="theme-toggle">
            <button onClick={toggleTheme} className="btn btn-secondary">
              {theme === "vs-dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
          </div>
          <div className="font-controls">
            <label>
              Font:
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="font-select"
              >
                <option value='Consolas, "Courier New", monospace'>
                  Consolas
                </option>
                <option value='Monaco, "Courier New", monospace'>Monaco</option>
                <option value='"Fira Code", "Courier New", monospace'>
                  Fira Code
                </option>
                <option value='"Source Code Pro", "Courier New", monospace'>
                  Source Code Pro
                </option>
                <option value='"Courier New", monospace'>Courier New</option>
              </select>
            </label>
            <label>
              Size:
              <input
                type="number"
                min="10"
                max="24"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="font-size-input"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="ide-body">
        <div className="file-tabs">
          {files.map((file) => (
            <div
              key={file.id}
              className={`file-tab ${activeFileId === file.id ? "active" : ""}`}
              onClick={() => setActiveFileId(file.id)}
            >
              <input
                type="text"
                value={file.name}
                onChange={(e) => renameFile(file.id, e.target.value, false)}
                onMouseDown={(e) => {
                  // If clicking on a different file, switch to it first
                  if (activeFileId !== file.id) {
                    setActiveFileId(file.id);
                    // Prevent default to avoid focusing input immediately
                    // User can click again to edit if needed
                    e.preventDefault();
                  }
                  // If clicking on the active file's input, allow normal behavior (focus for editing)
                  // Don't stop propagation - let the tab's onClick handle switching if needed
                }}
                onFocus={() => {
                  // Ensure we're on the right file when focusing to edit
                  if (activeFileId !== file.id) {
                    setActiveFileId(file.id);
                  }
                }}
                onBlur={(e) => {
                  const trimmedValue = e.target.value.trim();
                  if (!trimmedValue) {
                    // Restore original name if empty
                    renameFile(file.id, file.name, true);
                  } else {
                    // Enforce .js extension on blur
                    renameFile(file.id, trimmedValue, true);
                  }
                }}
                className="file-name-input"
              />
              {files.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFile(file.id);
                  }}
                  className="file-close-btn"
                  title="Close file"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="editor-container">
          {activeFile && (
            <Editor
              height="100%"
              language="javascript"
              theme={theme}
              value={activeFile.content}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              options={{
                fontSize: fontSize,
                fontFamily: fontFamily,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
                lineNumbers: "on",
                roundedSelection: false,
                cursorStyle: "line",
                cursorBlinking: "blink",
                folding: true,
                showFoldingControls: "always",
                matchBrackets: "always",
                autoIndent: "full",
                formatOnPaste: true,
                formatOnType: true,
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: "on",
                quickSuggestions: true,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
