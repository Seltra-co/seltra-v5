import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const options = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, index, args) =>
    arg.startsWith("--") ? [[arg.slice(2), args[index + 1]]] : [],
  ),
);

async function main(): Promise<void> {
  const salt = process.env.SELTRA_ENGINE_API_KEY_HASH_SALT;
  const workspaceId = options.workspace;
  const label = options.label;
  if (!salt || salt.length < 32) {
    throw new Error("SELTRA_ENGINE_API_KEY_HASH_SALT (32+ chars) is required.");
  }
  if (!workspaceId || !label) {
    throw new Error(
      "Usage: npx tsx scripts/mint-engine-key.ts --workspace <id> --label <text>",
    );
  }

  const prisma = new PrismaClient();
  try {
    const plaintext = `sk_seltra_${randomBytes(32).toString("base64url")}`;
    const keyHash = createHash("sha256")
      .update(salt)
      .update(":")
      .update(plaintext)
      .digest("hex");
    await prisma.workspaceCredit.upsert({
      where: { workspaceId },
      update: {},
      create: { workspaceId },
    });
    await prisma.seltraEngineApiKey.create({
      data: { workspaceId, label, keyHash },
    });
    process.stdout.write(`${plaintext}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
