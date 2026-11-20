// Keys (GitHub, Eventfrog) live in the macOS Keychain and nowhere else: no file, no
// environment file, no log. /usr/bin/security is run with argument arrays. A value is
// written through the tool's own prompt on standard input, so it never shows in a
// process list; reading one back happens only inside the server, for its own calls.

export const KEY_NAMES = ["github", "eventfrog"] as const;
export type KeyName = (typeof KEY_NAMES)[number];
export const isKeyName = (name: string): name is KeyName => (KEY_NAMES as readonly string[]).includes(name);

/** One line, nothing a paste accident brings along: no spaces, no control characters. */
// Letters, digits and the few marks keys use. No space, quote or backslash: the value is
// handed to the keychain tool as one word of a command line on its standard input.
export const validKey = (value: string) => /^[A-Za-z0-9_.\-=:+\/~@%]{8,400}$/.test(value);

const SECURITY = "/usr/bin/security";

export function keychain(service = "robins-studio") {
  const run = async (args: string[], input?: string) => {
    const proc = Bun.spawn([SECURITY, ...args], { stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited, new Response(proc.stderr).text()]);
    return { out, code };
  };
  return {
    /** Is there a key of this name? Asks for the item only, never for its value. */
    async has(name: KeyName): Promise<boolean> {
      return (await run(["find-generic-password", "-s", service, "-a", name])).code === 0;
    },
    /** The value, for the server's own use. It must never be sent to a browser or written to a log. */
    async read(name: KeyName): Promise<string | null> {
      const { out, code } = await run(["find-generic-password", "-s", service, "-a", name, "-w"]);
      return code === 0 ? out.replace(/\n$/, "") : null;
    },
    async save(name: KeyName, value: string): Promise<void> {
      if (!validKey(value)) throw new Error("not a key");
      // The tool's command mode (-i) reads the whole command from standard input, so the value
      // is in no argument list. Asking with a bare -w would read from the terminal instead of
      // standard input when the Studio was started from one.
      if (!/^[a-z0-9-]+$/.test(service)) throw new Error("not a service name");
      const { code } = await run(["-i"], `add-generic-password -U -s ${service} -a ${name} -l ${service}-${name} -w ${value}\n`);
      if (code !== 0) throw new Error(`the keychain refused (${code})`);
    },
    async remove(name: KeyName): Promise<void> {
      await run(["delete-generic-password", "-s", service, "-a", name]);
    },
  };
}

export type Keychain = ReturnType<typeof keychain>;
