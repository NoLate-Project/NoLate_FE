const { spawnSync } = require("child_process") as {
    spawnSync: (
        command: string,
        args: string[],
        options: {
            cwd: string;
            encoding: string;
            env: Record<string, string | undefined>;
        },
    ) => {
        status: number | null;
        stderr: string;
        stdout: string;
    };
};
const { resolve } = require("path") as {
    resolve: (...paths: string[]) => string;
};

describe("Metro release file discovery policy", () => {
    function loadUseWatchman(configuration: string): boolean {
        const result = spawnSync(
            process.execPath,
            [
                "-e",
                "const config = require(process.argv[1]); " +
                    "process.stdout.write(JSON.stringify(config.resolver.useWatchman));",
                resolve("metro.config.js"),
            ],
            {
                cwd: process.cwd(),
                encoding: "utf8",
                env: {
                    ...process.env,
                    CONFIGURATION: configuration,
                },
            },
        );
        if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout);
        }
        return JSON.parse(result.stdout) as boolean;
    }

    test("Release builds use the deterministic filesystem crawler", () => {
        expect(loadUseWatchman("Release")).toBe(false);
        expect(loadUseWatchman("Release-Staging")).toBe(false);
    });

    test("Debug builds retain Watchman for development performance", () => {
        expect(loadUseWatchman("Debug")).toBe(true);
    });
});
