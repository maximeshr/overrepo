import { parse } from "yaml";
import type { Detection, Detector } from "../types.ts";
import { isRecord } from "./util.ts";

const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];

/** Base images of a Dockerfile, ignoring references to earlier build stages */
const dockerBaseImages = (dockerfile: string): string[] => {
  const stages = new Set<string>();
  const images: string[] = [];

  for (const line of dockerfile.split("\n")) {
    const match = /^\s*FROM\s+(?:--\S+\s+)*(?<image>\S+)(?:\s+AS\s+(?<stage>\S+))?/iu.exec(
      line,
    )?.groups;

    const image = match?.image;

    if (image === undefined || image === "") {
      continue;
    }

    if (!stages.has(image.toLowerCase()) && !images.includes(image)) {
      images.push(image);
    }

    if (match?.stage !== undefined && match.stage !== "") {
      stages.add(match.stage.toLowerCase());
    }
  }

  return images;
};

export const dockerDetector: Detector = {
  id: "docker",
  async detect(files) {
    const tools: string[] = [];
    const dockerfile = await files.readText("Dockerfile");

    if (dockerfile !== undefined) {
      const images = dockerBaseImages(dockerfile);
      tools.push(images.length > 0 ? `Docker (${images.join(", ")})` : "Docker");
    }

    const composeFile = COMPOSE_FILES.find((file) => files.topLevel.includes(file));

    if (composeFile !== undefined && composeFile !== "") {
      let services: string[] = [];

      try {
        const compose: unknown = parse((await files.readText(composeFile)) ?? "");

        if (isRecord(compose) && isRecord(compose.services)) {
          services = Object.keys(compose.services);
        }
      } catch {
        // Unparsable compose file: still worth mentioning
      }

      tools.push(
        services.length > 0
          ? `Docker Compose (services: ${services.join(", ")})`
          : "Docker Compose",
      );
    }

    if (tools.length === 0) {
      return;
    }

    const detection: Detection = { tools };

    return detection;
  },
};
