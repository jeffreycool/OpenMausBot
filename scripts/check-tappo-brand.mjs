#!/usr/bin/env node
// FORK-ONLY guard (rename-tappo): asserts the TappoTeamBot brand values survive
// upstream merges. A weekly upstream merge can silently revert renamed fields in
// electron-builder.yml / package.json / brand constants / the deep-link scheme;
// this check turns that into a red CI run instead of a quiet rebrand.
//
//   node scripts/check-tappo-brand.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

/** Every TypeScript and plain-ESM file under a top-level folder, tests left out. `extensions` widens it to .tsx for the renderer. */
function listServer(folder, extensions = /\.(ts|mts|mjs|js)$/) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? (entry.name === "node_modules" ? [] : walk(path)) : extensions.test(entry.name) && !/\.(test|node-test)\./.test(entry.name) ? [path] : [];
  });
  return walk(join(root, folder));
}

let failures = 0;
function expect(name, condition, detail) {
  if (condition) return;
  failures += 1;
  console.error(`check-tappo-brand: FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

const builder = read("electron-builder.yml");
expect("electron-builder appId", /^appId:\s*com\.tappoteam\.app$/m.test(builder));
expect("electron-builder productName", /^productName:\s*TappoTeamBot$/m.test(builder));
expect("electron-builder artifactName", /^artifactName:\s*TappoTeamBot-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m.test(builder));
expect("electron-builder dmg artifactName", /artifactName:\s*TappoTeamBot-\$\{version\}-\$\{arch\}\.dmg/.test(builder));
expect("electron-builder nsis shortcutName", /^\s+shortcutName:\s*TappoTeamBot$/m.test(builder));
// New scheme first; the old one rides along only for the 30-day compat window (design D2).
expect("electron-builder protocol schemes (new first, legacy for the compat window)", /^\s+schemes:\s*\[tappoteambot, openmausbot\]$/m.test(builder));
expect("electron-builder publish repo", /^\s+repo:\s*TappoTeamBot$/m.test(builder));
expect("electron-builder publish owner", /^\s+owner:\s*jeffreycool$/m.test(builder));
expect("fork flag: electron/updater.mjs disables auto update",
  /const AGENTCHAT_DISABLE_AUTO_UPDATE = true;/.test(read("electron/updater.mjs")) &&
  /if \(AGENTCHAT_DISABLE_AUTO_UPDATE \|\| !app\.isPackaged\)/.test(read("electron/updater.mjs")));
expect("fork flag: settings-index.ts hides cloud billing",
  /const AGENTCHAT_HIDE_CLOUD_BILLING = true;/.test(read("src/components/settings/settings-index.ts")) &&
  /!AGENTCHAT_HIDE_CLOUD_BILLING &&/.test(read("src/components/settings/settings-index.ts")));

const pkg = JSON.parse(read("package.json"));
expect("package.json name", pkg.name === "tappoteambot");
expect("package.json desktopName", pkg.desktopName === "com.tappoteam.app.desktop");

const uiBrand = read("src/lib/brand.ts");
expect("src/lib/brand.ts PRODUCT_NAME", /export const PRODUCT_NAME = "TappoTeamBot";/.test(uiBrand));
expect("src/lib/brand.ts DEFAULT_BRAND", /DEFAULT_BRAND: Brand = \{ name: "TappoTeamBot" \}/.test(uiBrand));

const serverBrand = read("server/brand.ts");
expect("server/brand.ts PRODUCT_NAME", /export const PRODUCT_NAME = "TappoTeamBot";/.test(serverBrand));
expect("server/brand.ts DEFAULT_BRAND", /DEFAULT_BRAND: Brand = \{ name: "TappoTeamBot" \}/.test(serverBrand));

const config = read("server/config.ts");
// The data folder's place is decided in one function (server/data-dir.ts), by the server and the desktop app alike:
// a pre-rename folder is used where it is, and nothing moves at start (incident 2026-11-23) — only the
// `openmausbot migrate-data` command moves a folder.
const dataDirRule = read("server/data-dir.ts");
expect("server/data-dir.ts current data dir name", dataDirRule.includes('DATA_DIR_NAME = ".tappoteambot"'));
expect("server/data-dir.ts legacy names, newest first (.openmausbot, .opengrokbot)", dataDirRule.includes('LEGACY_DATA_DIR_NAMES = [".openmausbot", ".opengrokbot"]'));
expect("server/config.ts DATA_DIR comes from resolveDataDir", /const resolvedDataDir = resolveDataDir\(\{ home: dataHome\(\), env: process\.env \}\);\nexport const DATA_DIR = resolvedDataDir\.dir;/.test(config));
const ensureDirs = config.slice(config.indexOf("export function ensureDirs()"), config.indexOf("\n}\n", config.indexOf("export function ensureDirs()")));
expect("server/config.ts ensureDirs renames nothing", config.includes("export function ensureDirs()") && !/rename/i.test(ensureDirs));
for (const folder of ["server", "electron"]) {
  expect(`${folder}/ no longer knows the automatic-migration opt-in`, !listServer(folder).some((path) => readFileSync(path, "utf8").includes("OMB_ALLOW_DATA_MIGRATION")));
}

const main = read("electron/main.mjs");
expect("electron/main.mjs desktopDataDir", /return resolveDataDir\(\{ home: app\.getPath\("home"\), env: process\.env \}\)\.dir;/.test(main) && main.includes('from "./desktop-data-dir.mjs"') && !main.includes('".tappoteambot"'));
// The app's main process never asks the lease for a start-up rename of ~/.opengrokbot (electron/data-dir-lease.mjs
// prepareDataDir still can; nothing in the app passes it).
expect("electron/main.mjs asks for no start-up rename", !main.includes("legacyDataDir") && !main.includes(".opengrokbot"));
expect("electron/main.mjs desktopName", /com\.tappoteam\.app\.desktop/.test(main));

expect("deep link cloud", read("electron/cloud-entry.mjs").includes('CLOUD_DEEP_LINK = "tappoteambot://cloud"'));
expect("deep link pairing", read("packages/phone-protocol/src/pairing-link.ts").includes("tappoteambot://pair?"));
expect("deep link app-links", read("src/lib/app-links.ts").includes('APP_NAME = "TappoTeamBot"'));
expect("README fork notice", read("README.md").includes("TappoTeamBot is a fork of"));

// Wire-compat values that must NEVER be renamed (see docs/tappo-rename-design.md §2). If one of
// these flips, someone over-renamed and broke a protocol.
const health = read("server/index.ts");
expect("wire: /api/health app name unchanged", /\{ app: "openmausbot" \}/.test(health));
const mdns = read("companion/src/mdns.ts");
expect("wire: mDNS service unchanged", mdns.includes("_openmausbot._tcp"));
const peer = read("src/lib/peer-message.ts");
expect("wire: peer-message regex unchanged", peer.includes("another bot in this OpenMausBot workspace"));
const fish = read("src/lib/live-call-fish.ts");
expect("wire: FISH_UPDATE_PREFIX unchanged", fish.includes('FISH_UPDATE_PREFIX = "[OpenMausBot]"'));
const phoneSetup = read("src/lib/phone-setup.ts");
expect("wire: phone-setup error match unchanged", phoneSetup.includes(/^OpenMausBot could not reach/m.source ?? "OpenMausBot could not reach"));
expect("wire: extraResources license filename unchanged", builder.includes("licenses/OpenMausBot-LICENSE.txt"));

// Over-rename blind spots (rename audit 2026-11-23): values a careless brand sweep flips.
expect("wire: pairing credential prefix unchanged", read("packages/phone-protocol/src/pairing-code.ts").includes('PAIRING_CREDENTIAL_PREFIX = "omb_pair_"'));
expect("wire: session token prefix unchanged", read("server/sessions.ts").includes("`omb_sess_${"));
expect("APP_REPOSITORY still names upstream", read("src/lib/app-links.ts").includes('APP_REPOSITORY = "https://github.com/milind-soni/OpenMausBot"'));
expect("wire: NSBonjourServices unchanged", /^\s+- _openmausbot\._tcp$/m.test(builder));
const reportLines = read("src/locales/en.json").split("\n").filter((line) => /^\s*"server\.reports\./.test(line));
expect("locale server.reports.* keeps upstream's team name",
  reportLines.some((line) => line.includes("the MausBot team")) && reportLines.every((line) => !line.includes("TappoTeamBot")));
// Every place that used to spell the default by hand goes through the one function and spells none of its own.
const dataDirCallers = ["server/config.ts", "server/cli.ts", "server/server-launcher.ts", "server/config-cli.ts"];
for (const file of dataDirCallers) {
  expect(`${file} resolves the data dir through data-dir.ts`, /import \{[^}]*\b(resolveDataDir|defaultDataDir)\b[^}]*\} from "\.\/data-dir\.ts";/.test(read(file)));
}
for (const file of dataDirCallers) {
  expect(`${file} spells no default data dir of its own`, !read(file).includes('".tappoteambot"') && !read(file).includes('".openmausbot"'));
}
// The three that spell the default themselves still read OMB_DATA_DIR: the rule's own module and the Cloud home's entry.
for (const file of ["server/data-dir.ts", "server/cloud-home-start.ts"]) {
  expect(`${file} still reads OMB_DATA_DIR`, read(file).includes("OMB_DATA_DIR"));
}
// The Cloud home image's entry keeps its own posix default, under the earlier name: a Cloud home volume that already
// holds that folder keeps its data when the image changes (design §1.1-C3; the rename has no move for a Cloud home).
expect("server/cloud-home-start.ts keeps the Cloud home's data folder name",
  /OMB_DATA_DIR \|\| posix\.join\(home, "\.openmausbot"\)/.test(read("server/cloud-home-start.ts")));
expect("electron/main.mjs registers the tappoteambot scheme",
  /for \(const scheme of \["tappoteambot", "openmausbot"\]\) app\.setAsDefaultProtocolClient\(scheme\)/.test(main));
expect("the explicit migrate-data command exists and is reachable from the CLI", read("server/cli.ts").includes('argv[0] === "migrate-data"') && read("server/data-dir-migration.ts").includes("export function migrateDataDir("));
expect("wire: MausBot Cloud stays upstream's service name in English", !read("src/locales/en.json").includes("TappoTeamBot Cloud"));

// The fork's two switches (agentchat/README.md 登记表): this build neither shows the upstream Cloud's notices and product-email sign-up, nor
// reads the upstream project's announcements file. A merge that drops or flips either one brings the upstream's cards and prompts back.
expect("fork flag: src/lib/fork-flags.ts hides the upstream Cloud's notices",
  /export const AGENTCHAT_HIDE_UPSTREAM_CLOUD_NOTICES = true;/.test(read("src/lib/fork-flags.ts")));
expect("fork flag: AppNotices reads the switch from src/lib/fork-flags.ts", /import \{ AGENTCHAT_HIDE_UPSTREAM_CLOUD_NOTICES \} from "@\/lib\/fork-flags";/.test(read("src/components/AppNotices.tsx")));
expect("fork flag: shared/announcements.ts switches the upstream announcements file off",
  /export const UPSTREAM_ANNOUNCEMENTS_ENABLED = false;/.test(read("shared/announcements.ts")));
expect("fork flag: the server's announcements store is off unless the switch is on",
  /return !UPSTREAM_ANNOUNCEMENTS_ENABLED \|\| \(this\.options\.env \?\? process\.env\)\[ANNOUNCEMENTS_DISABLE_ENV\] === "1";/.test(read("server/announcements/feed.ts")));

// Upstream's own things keep upstream's name (design §1.1-B6; brand-test alignment 2026-11-23). The fork has no
// account, app-store app, Relay, partner deal or bug-report inbox of its own, so in each of these the only right
// name is MausBot and a brand sweep that flips one over-renames. The catalog rows were put back to their
// pre-rename text, paired key by key against c7fed03b2, hashes included.
const UPSTREAM_NAMED_COPY = {
  "cloudBuy.signIn.title": "2a: an account on upstream's accounts.openmausbot.com",
  "cloudBuy.signIn.signupClosedNote": "2a: whether upstream opens new accounts",
  "template.signInToPublish": "2a: publishing needs upstream's account (server/share-publish.ts)",
  "phoneUpdate.title": "2b: the phone app on the App Store and Google Play is upstream's",
  "phoneUpdate.body": "2b: the phone app on the App Store and Google Play is upstream's",
  "phoneUpdate.bodyMany": "2b: the phone app on the App Store and Google Play is upstream's",
  "native.connect.phoneLink": "2b: a link for upstream's phone app",
  "remote.devices.retired": "2b: the app on that phone is upstream's",
  "phone.code.e2e.relay": "2c: MausBot Relay",
  "remote.e2e.connecting": "2c: MausBot Relay",
  "productHunt.body": "2: upstream's own Product Hunt launch",
  "boatOffer.body": "2: upstream's Boat referral; src/lib/boat-offer.ts writes to Boat as MausBot",
  "modelgoOffer.title": "2: upstream's ModelGo offer",
  "composer.mention.devsDesc": "2d: @devs reports go to the MausBot team (server/devs-report-send.ts)",
  "files.outputs.help": "the folder on disk is still Documents/MausBot (electron/cloud-sync.mjs); the copy must name it",
};
const english = JSON.parse(read("src/locales/en.json"));
for (const [key, why] of Object.entries(UPSTREAM_NAMED_COPY)) {
  const value = english[key] ?? "";
  expect(`locale ${key} keeps upstream's name (${why})`, /\bMausBot\b/.test(value) && !value.includes("TappoTeamBot"));
}
// `{app}` is the product's name unless the call site names it. In these keys {app} is upstream's, so a call
// site hands them UPSTREAM_NAME (src/lib/brand.ts), never productName().
const UPSTREAM_NAMED_PLACEHOLDERS = [
  // 2a: upstream's account
  "settings.account.mausbot", "settings.account.signInTitle", "settings.account.signOut", "settings.account.emails",
  "settings.scope.account", "settings.signOut.title", "phone.pair.needsSignIn", "phone.pair.needsSignInLine",
  "devices.route.httpsAccount", "remote.diagnosis.step.account", "remote.diagnosis.relay.needsAccount",
  "remote.diagnosis.account.unreachable", "remote.diagnosis.account.busy",
  // 2b: upstream's phone app
  "phone.code.installAndScan", "phone.code.notCamera", "phone.code.typeIntro", "phone.code.typeThis", "phone.pair.rowLine",
  "remote.serverPairing.subtitle", "remote.serverPairing.sameWifiOnly", "teamPhone.subtitle", "remote.devices.retiredShort",
  "phone.pair.stepLine", "phone.pair.stepLineCloud",
  // 2c: upstream's Relay and addresses
  "remote.diagnosis.step.relay", "remote.diagnosis.relay.unavailable", "remote.diagnosis.relay.busy", "remote.diagnosis.relay.noAnswer",
  "remote.diagnosis.relay.unreachable", "remote.diagnosis.next.vpn", "remote.diagnosis.next.turnOn", "devices.route.relay",
  "devices.route.relayDetail", "devices.route.httpsDetail", "devices.reach.https", "devices.reach.relay",
  "remote.notice.relay", "remote.notice.https", "remote.client.companion.hint",
];
expect("src/lib/brand.ts UPSTREAM_NAME", /export const UPSTREAM_NAME = "MausBot";/.test(uiBrand));
expect("cloud-plan.ts names upstream's Cloud", !read("src/lib/cloud-plan.ts").includes("TappoTeamBot Cloud"));
for (const path of listServer("src", /\.(tsx|ts|mts|mjs|js)$/)) {
  readFileSync(path, "utf8").split("\n").forEach((line, index) => {
    if (!line.includes("productName()")) return;
    for (const key of UPSTREAM_NAMED_PLACEHOLDERS) {
      if (line.includes(`"${key}"`)) expect(`${relative(root, path)}:${index + 1} names ${key} with productName(), not upstream's name`, false);
    }
  });
}
// Three call sites reach those keys through a table or an entry id, so their line holds no key literal: pin them by name.
const phoneDevices = read("src/components/PhoneDevicesSection.tsx");
expect("phone route names and route notices take upstream's name",
  phoneDevices.includes("t(ROUTE_TEXT[route].name, { app: UPSTREAM_NAME })") && phoneDevices.includes("t(NOTICE_KEY[route], { app: UPSTREAM_NAME })"));
expect("settings search labels for upstream's account and Relay take upstream's name",
  read("src/components/settings/SettingsNav.tsx").includes("UPSTREAM_NAMED_HITS.has(hit.entry.id) ? UPSTREAM_NAME : productName()"));

if (failures > 0) {
  console.error(`check-tappo-brand: ${failures} brand check(s) failed — replay the rename (agentchat/README.md 登记表 「fork 元改」分组)`);
  process.exit(1);
}
console.log("check-tappo-brand: OK (brand surface intact, wire values unchanged)");
