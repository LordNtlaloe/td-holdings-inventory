import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api"

export function useMedicationStats() {
    return useQuery(api.medications.getMedicationStats)
}