// Who may talk to the Studio's server, and which files it may write. Pure, so the
// rules are tested without a socket.
//
// The server listens on 127.0.0.1 only. The editing screen lives at
// http://127.0.0.1:<port>/_studio/ and gets a random token in its HTML, new on every
// run. The preview is opened at http://localhost:<port>/: the same server, but to a
// browser a different origin, so a preview page can neither call the write API (its
// Origin and Host are not the server's own) nor read the editing screen's HTML to
// find the token.
import { normalize } from "node:path";
import { inEditScope } from "../editor/scope";

export const TOKEN_HEADER = "x-studio-token";

export type Self = { port: number; token: string };
export const studioHost = (self: Self) => `127.0.0.1:${self.port}`;
export const studioOrigin = (self: Self) => `http://${studioHost(self)}`;
export const previewOrigin = (self: Self) => `http://localhost:${self.port}`;

/** Any request at all: only under one of the server's two names, which stops a foreign name pointed at 127.0.0.1. */
export const knownHost = (req: Request, self: Self) => [studioHost(self), `localhost:${self.port}`].includes(req.headers.get("host") ?? "");

/** The preview (the built site) answers under the localhost name only. */
export const previewHostOnly = (req: Request, self: Self) => req.headers.get("host") === `localhost:${self.port}`;

/** The editing screen and its API answer under the 127.0.0.1 name only. */
export const studioHostOnly = (req: Request, self: Self) => req.headers.get("host") === studioHost(self);

/** An API request: the server's own Host, the server's own Origin when the browser sends one, and this run's token. Null when allowed, else why not. */
export function refuseApi(req: Request, self: Self): string | null {
  if (!studioHostOnly(req, self)) return "host";
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== studioOrigin(self)) return "origin";
  const token = req.headers.get(TOKEN_HEADER) ?? "";
  const given = Buffer.from(token), wanted = Buffer.from(self.token);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return "token";
  return null;
}

/** A repository path the write API may touch: inside the edit scope, written plainly, nothing that climbs out. Null when it is not. */
export function safeEditPath(path: unknown): string | null {
  if (typeof path !== "string" || !path || path.includes("\0") || path.includes("\\") || path.startsWith("/")) return null;
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  if (normalize(path) !== path) return null;
  return inEditScope(path) ? path : null;
}

/** A path inside the built preview for an address, or null for anything that climbs out. */
export function previewFile(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.includes("\0") || path.includes("\\") || path.split("/").some((part) => part === "..")) return null;
  path = path.replace(/^\/+/, "");
  if (path === "" || path.endsWith("/")) path += "index.html";
  return path;
}
