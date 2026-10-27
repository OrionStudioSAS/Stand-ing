export const deploymentAssetErrorMessage = "Un fichier de l'application n'est plus disponible. Enregistrez vos modifications, puis rechargez la page et relancez le téléchargement.";

export function isDeploymentAssetError(error) {
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|loading (?:css )?chunk/i.test(String(error?.message || error || ''));
}
