import { useState, useRef } from "react";
import { Download, Play, FileVideo, HardDrive, Clock, Link2, AlertCircle, Loader2, Copy, Check, Zap, Shield, Globe } from "lucide-react";

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
  data: FileData[];
  channel?: string;
}

interface LinkResult {
  url: string;
  status: "loading" | "success" | "error";
  data?: FileData;
  error?: string;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [results, setResults] = useState<LinkResult[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isValidTeraboxUrl = (u: string) => {
    try {
      const parsed = new URL(u);
      return parsed.hostname.includes("terabox") || parsed.hostname.includes("1024terabox") || parsed.hostname.includes("mirrobox") || u.includes("terabox");
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
    try {
      const apiUrl = `/api/terabox?url=${encodeURIComponent(url)}`;
      const res = await fetch(apiUrl);
      if (!res.ok) {
        throw new Error(`Server responded with status ${res.status}`);
      }
      const json: ApiResponse = await res.json();
      if (!json.success || !json.data || json.data.length === 0) {
        throw new Error("Could not fetch file data. The link may be invalid or expired.");
      }
      return { url, status: "success", data: json.data[0] };
    } catch (err: unknown) {
      let msg = "An unexpected error occurred.";
      if (err instanceof TypeError && err.message.includes("fetch")) {
        msg = "Network error. Please try again.";
      } else if (err instanceof Error) {
        msg = err.message;
      }
      return { url, status: "error", error: msg };
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

    const fetched = await Promise.all(valid.map(fetchOne));
    setResults(fetched);
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
                placeholder={"https://terabox.com/s/...\nhttps://terabox.com/s/...\nhttps://1024terabox.com/s/..."}
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

  // Success state
  const data = result.data!;
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
