import type { Detection, Detector } from "../types.ts";
import { isObject, isRecord, isString } from "../../core/json.ts";
import { known, stringRecord } from "./util.ts";
import type { JsonValue } from "../../core/json.ts";

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

/** `repositories` entries, whether composer.json lists them or keys them by name */
const repositoryEntries = (repositories: JsonValue | undefined): (JsonValue | undefined)[] => {
  if (Array.isArray(repositories)) {
    return repositories;
  }

  return isObject(repositories) ? Object.values(repositories) : [];
};

export const phpDetector: Detector = {
  id: "php",
  async detect(files): Promise<Detection | undefined> {
    const composer = await files.readJson("composer.json");

    if (!isRecord(composer)) {
      return files.topLevel.includes("index.php") ? { languages: ["PHP"] } : undefined;
    }

    const require = stringRecord(composer.require);
    const deps = { ...stringRecord(composer["require-dev"]), ...require };
    const has = (name: string) => name in deps;

    const frameworks = known(has, FRAMEWORKS);

    if (files.topLevel.includes("artisan") && !frameworks.includes("Laravel")) {
      frameworks.unshift("Laravel");
    }

    const repositories = repositoryEntries(composer.repositories);
    const scripts = isObject(composer.scripts) ? composer.scripts : {};

    const detection: Detection = {
      languages: ["PHP"],
      frameworks,
      packageManagers: ["composer"],
      tools: known(has, TOOLS),
      scripts: Object.entries(scripts).flatMap(([name, value]) =>
        /^(?:pre|post)-/u.test(name)
          ? []
          : [{ runner: "composer run", name, cmd: isString(value) ? value : undefined }],
      ),
      dependencies: Object.keys(deps)
        .filter((name) => name.includes("/"))
        .map((name) => ({ ecosystem: "composer", name })),
      references: repositories.flatMap((repo) =>
        isObject(repo) && isString(repo.url) ? [repo.url] : [],
      ),
      packages:
        isString(composer.name) && composer.name !== ""
          ? [{ ecosystem: "composer", name: composer.name }]
          : [],
    };

    if (require.php !== undefined && require.php !== "") {
      detection.runtimes = [`PHP ${require.php}`];
    }

    return detection;
  },
};
