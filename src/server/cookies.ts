// The session cookie: name, parsing, and the Set-Cookie strings.
export function cookieName(secure: boolean) {
  return secure ? "__Host-ribbon_session" : "ribbon_session";
}

export function readCookie(request: Request, ...names: string[]): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (names.includes(name)) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function readSessionToken(request: Request): string | undefined {
  return readCookie(request, cookieName(true), cookieName(false));
}

export function sessionCookie(token: string, secure: boolean): string {
  const maxAge = 14 * 24 * 60 * 60;
  return `${cookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearCookies(): string[] {
  return [
    `${cookieName(true)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `${cookieName(false)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  ];
}
