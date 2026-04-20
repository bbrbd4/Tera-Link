import { useState, useRef, useEffect } from "react";
import { Download, Play, FileVideo, HardDrive, Clock, Link2, AlertCircle, Loader2, Copy, Check, Zap, Shield, Globe, Bot, ExternalLink, FolderOpen, Folder, ChevronDown, ChevronUp, ChevronRight, File as FileIcon } from "lucide-react";

interface FileData {
  file_name: string;
  thumbnail: string;
  download_url: string;
  stream_url: string;
  new_stream_url: string;
  stream_final_url: string;
  file_size: string;
  file_size_bytes: number;
  share_url: string;
  duration: string;
  share_id: number;
  extension: string;
}

interface ApiResponse {
  success: boolean;
  data?: FileData[];
  channel?: string;
  kind?: "folder-tree";
  tree?: TeraboxTree;
  error?: string;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  sizeText: string;
  fsId?: string;
  category?: number;
  thumbnail?: string;
  shorturl: string;
  shareUrl: string;
  children?: TreeNode[];
}

interface TeraboxTree {
  root: TreeNode;
  totalFiles: number;
  totalFolders: number;
  totalSize: number;
  totalSizeText: string;
}

interface LinkResult {
  url: string;
  status: "loading" | "success" | "error";
  files?: FileData[];
  tree?: TeraboxTree;
  error?: string;
}

interface BotInfo {
  username: string;
  firstName: string;
  startedAt: number;
  processed: number;
  errors: number;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [results, setResults] = useState<LinkResult[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Owner-bot status (read-only)
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/bot/status");
        const json = await res.json();
        if (cancelled) return;
        setBotInfo(json.success && json.running && json.bot ? json.bot : null);
      } catch {
        // ignore
      }
    };
    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const isValidTeraboxUrl = (u: string) => {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      return /(terabox|1024terabox|mirrobox|teraboxshare|terasharelink|nephobox|momerybox|tibibox|4funbox|teraboxapp|teraboxlink)/.test(host);
    } catch {
      return false;
    }
  };

  const parseUrls = (text: string): string[] => {
    return text
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const fetchOne = async (url: string): Promise<LinkResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const apiUrl = `/api/terabox?url=${encodeURIComponent(url)}`;
      const res = await fetch(apiUrl, { signal: controller.signal });
      const json: ApiResponse = await res.json().catch(() => ({ success: false } as ApiResponse));
      if (!res.ok) {
        const serverMsg = (json as { error?: string }).error;
        throw new Error(serverMsg || `Server responded with status ${res.status}`);
      }
      if (json.kind === "folder-tree" && json.tree) {
        return { url, status: "success", tree: json.tree };
      }
      if (!json.success || !json.data || json.data.length === 0) {
        throw new Error("Could not fetch file data. The link may be invalid or expired.");
      }
      return { url, status: "success", files: json.data };
    } catch (err: unknown) {
      let msg = "An unexpected error occurred.";
      if (err instanceof DOMException && err.name === "AbortError") {
        msg = "Request timed out after 30s. The link may be slow or invalid.";
      } else if (err instanceof TypeError && err.message.includes("fetch")) {
        msg = "Network error. Please try again.";
      } else if (err instanceof Error) {
        msg = err.message;
      }
      return { url, status: "error", error: msg };
    } finally {
      clearTimeout(timer);
    }
  };

  const handleFetch = async () => {
    const urls = parseUrls(input);
    if (urls.length === 0) {
      setGlobalError("Please enter at least one TeraBox URL.");
      return;
    }

    const invalid = urls.filter((u) => !isValidTeraboxUrl(u));
    if (invalid.length > 0) {
      setGlobalError(
        invalid.length === urls.length
          ? "None of the URLs look like valid TeraBox links."
          : `${invalid.length} of ${urls.length} URLs don't look like valid TeraBox links and will be skipped.`
      );
    } else {
      setGlobalError(null);
    }

    const valid = urls.filter(isValidTeraboxUrl);
    if (valid.length === 0) {
      return;
    }

    setLoading(true);
    setResults(valid.map((url) => ({ url, status: "loading" })));

    // Process with limited concurrency so we don't overwhelm the upstream API,
    // and update each result as it finishes so the UI stays responsive.
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < valid.length) {
        const i = cursor++;
        const url = valid[i]!;
        const result = await fetchOne(url);
        setResults((prev) => {
          const next = prev.slice();
          next[i] = result;
          return next;
        });
      }
    };
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, valid.length) },
      () => worker(),
    );
    await Promise.all(workers);
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleFetch();
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      // ignore
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput((prev) => (prev ? `${prev}\n${text}` : text));
      inputRef.current?.focus();
    } catch {
      inputRef.current?.focus();
    }
  };

  const handleClear = () => {
    setInput("");
    setGlobalError(null);
    setResults([]);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getStreamUrl = (data: FileData) => {
    return data.stream_final_url || data.new_stream_url || data.stream_url || "";
  };

  const hasStream = (data: FileData) => {
    return !!(data.stream_final_url || data.new_stream_url || data.stream_url);
  };

  const linkCount = parseUrls(input).length;
  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Background gradient blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-[0.07]"
          style={{ background: "radial-gradient(circle, hsl(217 91% 60%), transparent 70%)" }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full opacity-[0.05]"
          style={{ background: "radial-gradient(circle, hsl(271 81% 56%), transparent 70%)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, hsl(217 91% 60%), transparent 60%)" }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center w-full max-w-3xl mx-auto px-4 py-12 flex-1">
        {/* Header */}
        <div className="text-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary rounded-full px-4 py-1.5 text-sm font-medium mb-6">
            <Zap className="w-3.5 h-3.5" />
            Free & Fast Downloads
          </div>
          <h1 className="text-5xl font-bold tracking-tight mb-4">
            <span className="text-foreground">TeraBox</span>{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(135deg, hsl(217 91% 60%), hsl(271 81% 56%))" }}
            >
              Downloader
            </span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto leading-relaxed">
            Paste one or more TeraBox share links and get instant download and stream access.
          </p>
        </div>

        {/* Input Card */}
        <div
          className="w-full rounded-2xl border border-card-border bg-card p-6 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5" />
                TeraBox Share URLs
                {linkCount > 0 && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                    {linkCount} {linkCount === 1 ? "link" : "links"}
                  </span>
                )}
              </label>
              <span className="text-xs text-muted-foreground">One link per line</span>
            </div>
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (globalError) setGlobalError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Paste your TeraBox link(s) here..."
                rows={4}
                className="w-full bg-muted/50 border border-input rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all duration-200 resize-y min-h-[100px] font-mono"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePaste}
                className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-secondary hover:bg-accent text-secondary-foreground text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
              >
                <Copy className="w-3.5 h-3.5" />
                Paste
              </button>
              {input && (
                <button
                  onClick={handleClear}
                  className="px-4 py-2.5 rounded-xl border border-input bg-secondary hover:bg-accent text-secondary-foreground text-sm font-medium transition-all duration-200"
                >
                  Clear
                </button>
              )}
            </div>
            {globalError && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {globalError}
              </div>
            )}
            <button
              onClick={handleFetch}
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed glow-pulse"
              style={{
                background: loading
                  ? "hsl(217 91% 60% / 0.7)"
                  : "linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 50%))",
                color: "hsl(222 47% 8%)",
                boxShadow: loading ? "none" : "0 4px 20px hsl(217 91% 60% / 0.35)",
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Fetching {results.length} {results.length === 1 ? "link" : "links"}...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  {linkCount > 1 ? `Get ${linkCount} Download Links` : "Get Download Links"}
                </>
              )}
            </button>
            <p className="text-xs text-muted-foreground text-center">
              Tip: paste multiple links separated by new lines &middot; Press Ctrl+Enter to fetch
            </p>
          </div>
        </div>

        {/* Telegram Bot Banner */}
        {botInfo && (
          <div className="w-full mb-6">
            <a
              href={`https://t.me/${botInfo.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between gap-3 px-5 py-4 rounded-2xl border border-card-border bg-card hover:bg-secondary/50 transition-all duration-200 group"
              style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: "linear-gradient(135deg, hsl(199 89% 48%), hsl(217 91% 60%))",
                    boxShadow: "0 2px 12px hsl(199 89% 48% / 0.3)",
                  }}
                >
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-sm text-foreground flex items-center gap-2">
                    Try our Telegram Bot
                    <span className="inline-flex items-center gap-1 text-xs bg-green-500/15 text-green-400 border border-green-500/25 rounded-full px-2 py-0.5 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      Live
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    @{botInfo.username} &middot; Send any TeraBox link in chat
                  </p>
                </div>
              </div>
              <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                Open <ExternalLink className="w-3 h-3" />
              </span>
            </a>
          </div>
        )}


        {/* Summary bar */}
        {results.length > 0 && !loading && (
          <div className="w-full mb-4 flex items-center justify-between text-xs text-muted-foreground px-2 animate-in fade-in duration-300">
            <span>
              {results.length} {results.length === 1 ? "result" : "results"}
            </span>
            <div className="flex items-center gap-3">
              {successCount > 0 && (
                <span className="flex items-center gap-1 text-green-400">
                  <Check className="w-3 h-3" /> {successCount} ready
                </span>
              )}
              {errorCount > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertCircle className="w-3 h-3" /> {errorCount} failed
                </span>
              )}
            </div>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="w-full flex flex-col gap-4">
            {results.map((result, idx) => (
              <ResultCard
                key={`${result.url}-${idx}`}
                result={result}
                index={idx}
                copiedUrl={copiedUrl}
                onCopy={handleCopy}
                formatBytes={formatBytes}
                getStreamUrl={getStreamUrl}
                hasStream={hasStream}
              />
            ))}
          </div>
        )}

        {/* Feature Badges */}
        {results.length === 0 && !loading && (
          <div className="flex flex-wrap justify-center gap-3 mt-4 animate-in fade-in duration-500 delay-200">
            {[
              { icon: <Zap className="w-3.5 h-3.5" />, label: "Bulk fetch" },
              { icon: <Shield className="w-3.5 h-3.5" />, label: "No login required" },
              { icon: <Globe className="w-3.5 h-3.5" />, label: "Any TeraBox link" },
              { icon: <Play className="w-3.5 h-3.5" />, label: "Stream support" },
            ].map(({ icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-1.5 text-xs text-muted-foreground bg-card border border-card-border rounded-full px-3 py-1.5"
              >
                <span className="text-primary/70">{icon}</span>
                {label}
              </div>
            ))}
          </div>
        )}

        {/* How it works */}
        {results.length === 0 && !loading && (
          <div className="mt-14 w-full animate-in fade-in duration-500 delay-300">
            <p className="text-center text-xs text-muted-foreground font-medium uppercase tracking-wider mb-6">How it works</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { step: "1", title: "Copy links", desc: "Grab one or more TeraBox share URLs" },
                { step: "2", title: "Paste & fetch", desc: "Paste each on its own line, then click fetch" },
                { step: "3", title: "Download all", desc: "Get download or stream links for every file" },
              ].map(({ step, title, desc }) => (
                <div key={step} className="text-center">
                  <div
                    className="w-9 h-9 rounded-xl mx-auto mb-3 flex items-center justify-center text-sm font-bold"
                    style={{
                      background: "linear-gradient(135deg, hsl(217 91% 60% / 0.2), hsl(271 81% 56% / 0.1))",
                      border: "1px solid hsl(217 91% 60% / 0.3)",
                      color: "hsl(217 91% 65%)",
                    }}
                  >
                    {step}
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">{title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="relative z-10 text-center py-6 px-4 border-t border-border/50 text-sm text-muted-foreground">
        <span>Powered by </span>
        <a
          href="https://t.me/bb8_bd"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold bg-clip-text text-transparent hover:opacity-80 transition-opacity"
          style={{ backgroundImage: "linear-gradient(135deg, hsl(217 91% 60%), hsl(271 81% 56%))" }}
        >
          bb8_bd
        </a>
        <span> &mdash; </span>
        <span className="text-amber-400/90">
          Warning এইটা শুধু মাত্র ১৯/২০ দেখার জন্য তৈরি করা হয়েছে।
        </span>
      </footer>
    </div>
  );
}

interface ResultCardProps {
  result: LinkResult;
  index: number;
  copiedUrl: string | null;
  onCopy: (text: string) => void;
  formatBytes: (bytes: number) => string;
  getStreamUrl: (data: FileData) => string;
  hasStream: (data: FileData) => boolean;
}

function ResultCard({ result, index, copiedUrl, onCopy, formatBytes, getStreamUrl, hasStream }: ResultCardProps) {
  // Loading state
  if (result.status === "loading") {
    return (
      <div
        className="w-full rounded-2xl border border-card-border bg-card p-6 animate-in fade-in duration-300"
        style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animationDelay: `${index * 50}ms` }}
      >
        <div className="flex gap-4">
          <div className="w-32 h-20 rounded-xl shimmer shrink-0" />
          <div className="flex-1 flex flex-col gap-3">
            <div className="h-5 rounded-lg shimmer w-3/4" />
            <div className="h-4 rounded-lg shimmer w-1/2" />
            <div className="h-4 rounded-lg shimmer w-1/3" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="h-12 rounded-xl shimmer" />
          <div className="h-12 rounded-xl shimmer" />
        </div>
      </div>
    );
  }

  // Error state
  if (result.status === "error") {
    return (
      <div
        className="w-full rounded-2xl border border-destructive/30 bg-destructive/5 p-5 animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-destructive/15 border border-destructive/30 flex items-center justify-center shrink-0">
            <AlertCircle className="w-4 h-4 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-destructive mb-1">Failed to fetch</p>
            <p className="text-xs text-muted-foreground truncate mb-2" title={result.url}>
              {result.url}
            </p>
            <p className="text-sm text-destructive/90">{result.error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Success state — folder-tree variant (nested subfolders from official TeraBox API)
  if (result.tree) {
    return (
      <FolderTreeCard
        tree={result.tree}
        url={result.url}
        index={index}
        copiedUrl={copiedUrl}
        onCopy={onCopy}
      />
    );
  }

  if (!result.files || result.files.length === 0) {
    return null;
  }
  const files = result.files;

  // Folder view (multiple files)
  if (files.length > 1) {
    return (
      <FolderCard
        files={files}
        shareUrl={result.url}
        index={index}
        copiedUrl={copiedUrl}
        onCopy={onCopy}
        formatBytes={formatBytes}
        getStreamUrl={getStreamUrl}
        hasStream={hasStream}
      />
    );
  }

  // Single-file view
  const data = files[0]!;
  return (
    <div
      className="w-full rounded-2xl border border-card-border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-400"
      style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animationDelay: `${index * 50}ms` }}
    >
      {/* Thumbnail + Meta */}
      <div className="flex gap-4 p-6 border-b border-border">
        {data.thumbnail ? (
          <div className="w-36 h-24 rounded-xl overflow-hidden shrink-0 border border-border bg-muted">
            <img
              src={data.thumbnail}
              alt={data.file_name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        ) : (
          <div className="w-36 h-24 rounded-xl shrink-0 border border-border bg-muted flex items-center justify-center">
            <FileVideo className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-foreground text-base leading-snug mb-3 truncate" title={data.file_name}>
            {data.file_name}
          </h2>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <HardDrive className="w-3.5 h-3.5 text-primary/70" />
              <span>{data.file_size || formatBytes(data.file_size_bytes)}</span>
            </div>
            {data.duration && data.duration !== "00:00" && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="w-3.5 h-3.5 text-primary/70" />
                <span>{data.duration}</span>
              </div>
            )}
            {data.extension && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <FileVideo className="w-3.5 h-3.5 text-primary/70" />
                <span className="uppercase">{data.extension.replace(".", "")}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="p-6 flex flex-col gap-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Available Links</p>

        {data.download_url && (
          <div className="flex gap-2">
            <a
              href={data.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 50%))",
                color: "hsl(222 47% 8%)",
                boxShadow: "0 4px 16px hsl(217 91% 60% / 0.3)",
              }}
            >
              <Download className="w-4 h-4" />
              Download File
            </a>
            <button
              onClick={() => onCopy(data.download_url)}
              className="px-4 py-3 rounded-xl border border-input bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200 flex items-center gap-1.5 text-sm"
              title="Copy download URL"
            >
              {copiedUrl === data.download_url ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        )}

        {hasStream(data) && (
          <div className="flex gap-2">
            <a
              href={getStreamUrl(data)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border border-border bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200 hover:border-primary/30 active:scale-[0.98]"
            >
              <Play className="w-4 h-4" />
              Stream Online
            </a>
            <button
              onClick={() => onCopy(getStreamUrl(data))}
              className="px-4 py-3 rounded-xl border border-input bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200 flex items-center gap-1.5 text-sm"
              title="Copy stream URL"
            >
              {copiedUrl === getStreamUrl(data) ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        )}

        {data.share_url && (
          <div className="flex gap-2">
            <a
              href={data.share_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border border-border bg-muted/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all duration-200 active:scale-[0.98]"
            >
              <Globe className="w-4 h-4" />
              Original Share Page
            </a>
            <button
              onClick={() => onCopy(data.share_url)}
              className="px-4 py-3 rounded-xl border border-input bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200 flex items-center gap-1.5 text-sm"
              title="Copy share URL"
            >
              {copiedUrl === data.share_url ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface FolderCardProps {
  files: FileData[];
  shareUrl: string;
  index: number;
  copiedUrl: string | null;
  onCopy: (text: string) => void;
  formatBytes: (bytes: number) => string;
  getStreamUrl: (data: FileData) => string;
  hasStream: (data: FileData) => boolean;
}

function FolderCard({
  files,
  shareUrl,
  index,
  copiedUrl,
  onCopy,
  formatBytes,
  getStreamUrl,
  hasStream,
}: FolderCardProps) {
  const [expanded, setExpanded] = useState(true);
  const totalBytes = files.reduce((sum, f) => sum + (Number(f.file_size_bytes) || 0), 0);

  return (
    <div
      className="w-full rounded-2xl border border-card-border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-400"
      style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animationDelay: `${index * 50}ms` }}
    >
      {/* Folder header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-4 p-5 border-b border-border hover:bg-secondary/30 transition-colors text-left"
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg, hsl(271 81% 56%), hsl(217 91% 60%))",
            boxShadow: "0 4px 16px hsl(271 81% 56% / 0.3)",
          }}
        >
          <FolderOpen className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm">
            Folder &middot; {files.length} files
          </p>
          <p className="text-xs text-muted-foreground truncate" title={shareUrl}>
            {totalBytes > 0 ? formatBytes(totalBytes) : ""} {totalBytes > 0 ? "· " : ""}{shareUrl}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* File list */}
      {expanded && (
        <div className="divide-y divide-border">
          {files.map((file, i) => (
            <FolderFileRow
              key={`${file.share_id}-${i}`}
              file={file}
              copiedUrl={copiedUrl}
              onCopy={onCopy}
              formatBytes={formatBytes}
              getStreamUrl={getStreamUrl}
              hasStream={hasStream}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FolderFileRowProps {
  file: FileData;
  copiedUrl: string | null;
  onCopy: (text: string) => void;
  formatBytes: (bytes: number) => string;
  getStreamUrl: (data: FileData) => string;
  hasStream: (data: FileData) => boolean;
}

function FolderFileRow({
  file,
  copiedUrl,
  onCopy,
  formatBytes,
  getStreamUrl,
  hasStream,
}: FolderFileRowProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 p-4">
      {/* Thumbnail */}
      {file.thumbnail ? (
        <div className="w-full sm:w-28 h-32 sm:h-20 rounded-lg overflow-hidden shrink-0 border border-border bg-muted">
          <img
            src={file.thumbnail}
            alt={file.file_name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      ) : (
        <div className="w-full sm:w-28 h-32 sm:h-20 rounded-lg shrink-0 border border-border bg-muted flex items-center justify-center">
          <FileVideo className="w-6 h-6 text-muted-foreground" />
        </div>
      )}

      {/* Info + actions */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground truncate" title={file.file_name}>
          {file.file_name}
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <HardDrive className="w-3 h-3 text-primary/70" />
            {file.file_size || formatBytes(file.file_size_bytes)}
          </span>
          {file.duration && file.duration !== "00:00" && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-primary/70" />
              {file.duration}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mt-1">
          {file.download_url && (
            <a
              href={file.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 50%))",
                color: "hsl(222 47% 8%)",
              }}
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          )}
          {hasStream(file) && (
            <a
              href={getStreamUrl(file)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200 hover:border-primary/30 active:scale-[0.98]"
            >
              <Play className="w-3.5 h-3.5" />
              Stream
            </a>
          )}
          {file.download_url && (
            <button
              onClick={() => onCopy(file.download_url)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-input bg-secondary hover:bg-accent text-secondary-foreground transition-all duration-200"
              title="Copy download URL"
            >
              {copiedUrl === file.download_url ? (
                <Check className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              Copy link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface FolderTreeCardProps {
  tree: TeraboxTree;
  url: string;
  index: number;
  copiedUrl: string | null;
  onCopy: (text: string) => void;
}

function FolderTreeCard({ tree, url, index, copiedUrl, onCopy }: FolderTreeCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [search, setSearch] = useState("");

  const filterNode = (node: TreeNode, q: string): TreeNode | null => {
    if (!q) return node;
    const ql = q.toLowerCase();
    if (!node.isDir) {
      return node.name.toLowerCase().includes(ql) ? node : null;
    }
    const kept = (node.children || [])
      .map((c) => filterNode(c, ql))
      .filter((c): c is TreeNode => c !== null);
    if (kept.length === 0 && !node.name.toLowerCase().includes(ql)) return null;
    return { ...node, children: kept };
  };

  const root = filterNode(tree.root, search.trim()) ?? tree.root;

  return (
    <div
      className="w-full rounded-2xl border border-card-border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-400"
      style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animationDelay: `${index * 50}ms` }}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 p-4 sm:p-5 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
          <FolderOpen className="w-6 h-6 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground mb-0.5">
            Folder · {tree.totalFiles} files{tree.totalFolders > 0 && ` in ${tree.totalFolders} subfolders`}
          </p>
          <p className="text-xs text-muted-foreground truncate" title={url}>
            {tree.totalSizeText} · {url}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-card-border">
          <div className="p-3 sm:p-4 border-b border-card-border bg-secondary/20">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files..."
              className="w-full px-3 py-2 rounded-lg bg-input border border-input text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="max-h-[600px] overflow-y-auto p-2">
            {(root.children || []).map((child, i) => (
              <TreeRow
                key={`${child.path}-${i}`}
                node={child}
                depth={0}
                copiedUrl={copiedUrl}
                onCopy={onCopy}
              />
            ))}
            {(!root.children || root.children.length === 0) && (
              <p className="text-center text-sm text-muted-foreground py-8">No files match your search.</p>
            )}
          </div>
          <div className="p-3 border-t border-card-border bg-secondary/10 text-xs text-muted-foreground text-center">
            Click Watch to stream a file in-app, or Download to save it directly.
          </div>
        </div>
      )}
    </div>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  copiedUrl: string | null;
  onCopy: (text: string) => void;
}

type DlinkState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ready" }
  | { status: "error"; message: string };

function TreeRow({ node, depth, copiedUrl, onCopy }: TreeRowProps) {
  const [open, setOpen] = useState(depth < 1);
  const [dlinkState, setDlinkState] = useState<DlinkState>({ status: "idle" });
  const [showPlayer, setShowPlayer] = useState(false);

  const parentDir = node.path.includes("/")
    ? node.path.substring(0, node.path.lastIndexOf("/")) || "/"
    : "/";
  const baseParams = new URLSearchParams({
    surl: node.shorturl || "",
    dir: parentDir,
    fsId: String(node.fsId || ""),
  }).toString();
  const streamUrl = `/api/terabox/stream?${baseParams}`;
  const downloadUrl = `${streamUrl}&dl=1`;

  const ensureLink = async (): Promise<boolean> => {
    if (dlinkState.status === "ready") return true;
    if (dlinkState.status === "checking") return false;
    setDlinkState({ status: "checking" });
    try {
      const res = await fetch(`/api/terabox/dlink?${baseParams}`);
      const data = (await res.json()) as {
        success: boolean;
        error?: string;
      };
      if (!data.success) {
        setDlinkState({ status: "error", message: data.error || "Failed to get link" });
        return false;
      }
      setDlinkState({ status: "ready" });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setDlinkState({ status: "error", message: msg });
      return false;
    }
  };

  const handleWatch = async () => {
    setShowPlayer(true);
    await ensureLink();
  };

  const handleDownload = async () => {
    const ok = await ensureLink();
    if (!ok) return;
    window.location.href = downloadUrl;
  };

  const handleCopy = async () => {
    const ok = await ensureLink();
    if (!ok) return;
    const fullUrl = new URL(downloadUrl, window.location.origin).href;
    onCopy(fullUrl);
  };

  if (node.isDir) {
    const childCount = (node.children || []).length;
    return (
      <div className="mb-1">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-accent/40 transition-colors text-left"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
          <Folder className="w-4 h-4 text-purple-400 flex-shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">{node.name}</span>
          <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{childCount} items</span>
        </button>
        {open && (
          <div>
            {(node.children || []).map((child, i) => (
              <TreeRow
                key={`${child.path}-${i}`}
                node={child}
                depth={depth + 1}
                copiedUrl={copiedUrl}
                onCopy={onCopy}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File row
  const isVideo = (node.category === 1) || /\.(mp4|mkv|webm|mov|avi|flv|wmv|m4v)$/i.test(node.name);

  return (
    <>
    <div
      className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-accent/30 transition-colors group"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <div className="w-4 flex-shrink-0" />
      {node.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={node.thumbnail}
          alt=""
          className="w-10 h-10 rounded object-cover bg-secondary flex-shrink-0"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : isVideo ? (
        <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center flex-shrink-0">
          <FileVideo className="w-4 h-4 text-muted-foreground" />
        </div>
      ) : (
        <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center flex-shrink-0">
          <FileIcon className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate" title={node.name}>
          {node.name}
        </p>
        <p className="text-xs text-muted-foreground">{node.sizeText}</p>
      </div>
      {isVideo && (
        <button
          onClick={handleWatch}
          disabled={dlinkState.status === "checking"}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/40 transition-all flex-shrink-0 disabled:opacity-60"
          title="Watch this video here"
        >
          <Play className="w-3 h-3" />
          Watch
        </button>
      )}
      <button
        onClick={handleDownload}
        disabled={dlinkState.status === "checking"}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-all flex-shrink-0 disabled:opacity-60"
        title="Download file"
      >
        {dlinkState.status === "checking" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Download className="w-3 h-3" />
        )}
        Download
      </button>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs border border-input bg-secondary hover:bg-accent text-secondary-foreground transition-all flex-shrink-0"
        title="Copy direct link"
      >
        {copiedUrl && copiedUrl.endsWith(downloadUrl) ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>

    </div>
      {dlinkState.status === "error" && !showPlayer && (
        <div
          className="text-xs text-red-400 px-2 pb-2 -mt-1"
          style={{ paddingLeft: `${depth * 16 + 60}px` }}
        >
          {dlinkState.message}
        </div>
      )}
      {showPlayer && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowPlayer(false)}
        >
          <div
            className="relative w-full max-w-4xl bg-card border border-card-border rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
              <p className="text-sm font-semibold text-foreground truncate pr-4">{node.name}</p>
              <button
                onClick={() => setShowPlayer(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="bg-black flex items-center justify-center" style={{ minHeight: "60vh" }}>
              {dlinkState.status === "checking" && (
                <div className="flex items-center gap-2 text-muted-foreground py-12">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Preparing stream...</span>
                </div>
              )}
              {dlinkState.status === "error" && (
                <p className="text-sm text-red-400 py-12 px-4 text-center">{dlinkState.message}</p>
              )}
              {dlinkState.status === "ready" && (
                <video
                  src={streamUrl}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="w-full max-h-[80vh]"
                >
                  Your browser does not support video playback.
                </video>
              )}
            </div>
            {dlinkState.status === "ready" && (
              <div className="px-4 py-3 border-t border-card-border flex items-center justify-end gap-2">
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
