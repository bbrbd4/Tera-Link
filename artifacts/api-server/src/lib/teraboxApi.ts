export interface TeraboxFileData {
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

export interface TeraboxApiResponse {
  success: boolean;
  data: TeraboxFileData[];
  channel?: string;
}

export async function fetchTeraboxInfo(url: string): Promise<TeraboxApiResponse> {
  const apiUrl = `https://gold-newt-367030.hostingersite.com/tera.php?url=${encodeURIComponent(url)}`;
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TeraBoxDownloader/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`Upstream API responded with status ${response.status}`);
  }
  const data = (await response.json()) as TeraboxApiResponse;
  if (!data.success || !data.data || data.data.length === 0) {
    const err: Error & { code?: string } = new Error(
      "This link is invalid, expired, private, or the file was deleted. Please check the link on TeraBox and try again."
    );
    err.code = "LINK_INVALID";
    throw err;
  }
  return data;
}
