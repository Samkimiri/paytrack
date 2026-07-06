import type { Business, BusinessId } from "./types";

export const businesses: Record<BusinessId, Business> = {
  scds: {
    id: "scds",
    name: "Sam Creative Design School",
    shortName: "SCDS",
    primary: "#1F2A44",
    accent: "#3B4E8C",
    success: "#D9A441",
    alert: "#C4665A",
    light: "#F7F8FA",
  },
  graphics: {
    id: "graphics",
    name: "Sam Creative Graphics",
    shortName: "Graphics",
    tagline: "Where Creativity Meets Strategy.",
    primary: "#1C1F26",
    accent: "#1F6E52",
    success: "#C9974C",
    alert: "#B5533C",
    light: "#F6F5F3",
  },
};
