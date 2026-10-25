export async function copyToClipboard(value) {
  if (!navigator?.clipboard?.writeText) {
    const textArea = document.createElement("textarea");
    textArea.value = value;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    return true;
  }

  await navigator.clipboard.writeText(value);
  return true;
}

export function parseGitHubRepo(repoUrl) {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch (error) {
    return null;
  }
  return null;
}
