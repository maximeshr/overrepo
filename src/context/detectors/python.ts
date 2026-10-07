import type { Detection, Detector } from "../types.ts";
import { known } from "./util.ts";

const FRAMEWORKS = [
  ["django", "Django"],
  ["fastapi", "FastAPI"],
  ["flask", "Flask"],
  ["starlette", "Starlette"],
  ["celery", "Celery"],
  ["sqlalchemy", "SQLAlchemy"],
  ["pydantic", "Pydantic"],
] as const;

const TOOLS = [
  ["pytest", "pytest"],
  ["ruff", "Ruff"],
  ["mypy", "mypy"],
] as const;

const MANAGERS = [
  ["uv.lock", "uv"],
  ["poetry.lock", "poetry"],
  ["pdm.lock", "pdm"],
  ["Pipfile", "pipenv"],
  ["requirements.txt", "pip"],
] as const;

export const pythonDetector: Detector = {
  id: "python",
  async detect(files) {
    const candidates = ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"];
    if (!candidates.some((file) => files.topLevel.includes(file))) return undefined;
    const pyproject = (await files.readText("pyproject.toml")) ?? "";
    const corpus = [
      pyproject,
      (await files.readText("requirements.txt")) ?? "",
      (await files.readText("Pipfile")) ?? "",
      (await files.readText("setup.py")) ?? "",
    ]
      .join("\n")
      .toLowerCase();
    const mentions = (name: string) =>
      new RegExp(`(^|[^a-z0-9_-])${name}([^a-z0-9_-]|$)`, "m").test(corpus);

    let manager = MANAGERS.find(([file]) => files.topLevel.includes(file))?.[1];
    if (!manager && /\[tool\.poetry\]/.test(pyproject)) manager = "poetry";

    const detection: Detection = {
      languages: ["Python"],
      frameworks: known(mentions, FRAMEWORKS),
      packageManagers: [manager ?? "pip"],
      tools: known(mentions, TOOLS),
    };
    const name = /^name\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1];
    if (name) detection.packages = [{ ecosystem: "pypi", name: name.toLowerCase() }];
    const requires = /^requires-python\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1];
    if (requires) detection.runtimes = [`Python ${requires}`];
    return detection;
  },
};
