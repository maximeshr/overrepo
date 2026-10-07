import type { Detection, Detector } from "../types.ts";
import { isRecord, known, stringRecord } from "./util.ts";

const FRAMEWORKS = [
  ["laravel/framework", "Laravel"],
  ["symfony/framework-bundle", "Symfony"],
  ["symfony/symfony", "Symfony"],
  ["api-platform/core", "API Platform"],
  ["slim/slim", "Slim"],
  ["cakephp/cakephp", "CakePHP"],
  ["yiisoft/yii2", "Yii 2"],
  ["laminas/laminas-mvc", "Laminas"],
  ["drupal/core", "Drupal"],
  ["drupal/core-recommended", "Drupal"],
  ["magento/framework", "Magento"],
  ["roots/wordpress", "WordPress"],
  ["johnpbloch/wordpress", "WordPress"],
  ["doctrine/orm", "Doctrine ORM"],
] as const;

const TOOLS = [
  ["phpunit/phpunit", "PHPUnit"],
  ["pestphp/pest", "Pest"],
  ["phpstan/phpstan", "PHPStan"],
  ["vimeo/psalm", "Psalm"],
  ["friendsofphp/php-cs-fixer", "PHP CS Fixer"],
  ["laravel/pint", "Pint"],
] as const;

export const phpDetector: Detector = {
  id: "php",
  async detect(files) {
    const composer = await files.readJson<Record<string, unknown>>("composer.json");
    if (!isRecord(composer)) {
      return files.topLevel.includes("index.php") ? { languages: ["PHP"] } : undefined;
    }
    const require = stringRecord(composer.require);
    const deps = { ...stringRecord(composer["require-dev"]), ...require };
    const has = (name: string) => name in deps;

    const frameworks = known(has, FRAMEWORKS);
    if (files.topLevel.includes("artisan") && !frameworks.includes("Laravel"))
      frameworks.unshift("Laravel");

    const repositories = Array.isArray(composer.repositories)
      ? composer.repositories
      : isRecord(composer.repositories)
        ? Object.values(composer.repositories)
        : [];

    const detection: Detection = {
      languages: ["PHP"],
      frameworks,
      packageManagers: ["composer"],
      tools: known(has, TOOLS),
      scripts: Object.keys(isRecord(composer.scripts) ? composer.scripts : {})
        .filter((name) => !/^(pre|post)-/.test(name))
        .map((name) => {
          const value = (composer.scripts as Record<string, unknown>)[name];
          return {
            runner: "composer run",
            name,
            cmd: typeof value === "string" ? value : undefined,
          };
        }),
      dependencies: Object.keys(deps)
        .filter((name) => name.includes("/"))
        .map((name) => ({ ecosystem: "composer", name })),
      references: repositories.flatMap((repo) =>
        isRecord(repo) && typeof repo.url === "string" ? [repo.url] : [],
      ),
      packages:
        typeof composer.name === "string" && composer.name
          ? [{ ecosystem: "composer", name: composer.name }]
          : [],
    };
    if (require.php) detection.runtimes = [`PHP ${require.php}`];
    return detection;
  },
};
