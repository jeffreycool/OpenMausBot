/** The Use my Mac link older bot messages hold; it shows as plain text. */
export const USE_MY_COMPUTER_URL = "tappoteambot://use-my-computer";

export function isUseMyComputerUrl(value: string): boolean {
  const text = value.trim().toLowerCase();
  // Fork rename compat: older bot messages hold the pre-rename link.
  return text === USE_MY_COMPUTER_URL || text === "openmausbot://use-my-computer";
}
