const [majorText, minorText] = process.versions.node.split(".");
const major = Number(majorText);
const minor = Number(minorText);

const supported =
    (major === 22 && minor >= 11) ||
    major === 24;

if (!supported) {
    throw new Error(
        `Unsupported Node.js ${process.versions.node}. Use Node 22.11+ or Node 24 LTS.`,
    );
}

console.log(`Node.js ${process.versions.node} satisfies the release toolchain contract.`);
