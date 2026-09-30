import { QueryClient, useQuery } from "@tanstack/react-query";
import type {
  GameResponse,
  LeadersResponse,
  NightInfo,
  RecapResponse,
  StateResponse,
  StatusResponse,
  TeamResponse,
  Tremor,
  TremorPage,
} from "./types.gen";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: false } },
});

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText} for ${path}`);
  return (await res.json()) as T;
}

export const useStateQuery = () =>
  useQuery({ queryKey: ["state"], queryFn: () => api<StateResponse>("/state") });

export const useTeam = (abbrev: string) =>
  useQuery({ queryKey: ["team", abbrev], queryFn: () => api<TeamResponse>(`/teams/${abbrev}`) });

export const useGame = (id: string) =>
  useQuery({ queryKey: ["game", id], queryFn: () => api<GameResponse>(`/games/${id}`) });

export const useTremor = (id: string) =>
  useQuery({ queryKey: ["tremor", id], queryFn: () => api<Tremor>(`/tremors/${id}`) });

export const useTremors = (season: number, sort: "magnitude" | "recent", limit = 100) =>
  useQuery({
    queryKey: ["tremors", season, sort, limit],
    queryFn: () => api<TremorPage>(`/tremors?season=${season}&sort=${sort}&limit=${limit}`),
  });

export const useLeaders = (season: number, kind: LeadersResponse["kind"]) =>
  useQuery({
    queryKey: ["leaders", season, kind],
    queryFn: () => api<LeadersResponse>(`/leaders/ppa?season=${season}&kind=${kind}`),
  });

export const useNights = (season: number) =>
  useQuery({
    queryKey: ["nights", season],
    queryFn: () => api<NightInfo[]>(`/replay/nights?season=${season}`),
  });

export const useRecap = (date: string) =>
  useQuery({
    queryKey: ["recap", date],
    queryFn: () => api<RecapResponse>(`/recaps/${date}`),
    retry: false,
  });

/** Methodology reports are free-form JSON written by the training jobs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Methodology = Record<string, any>;

export const useMethodology = () =>
  useQuery({
    queryKey: ["methodology"],
    queryFn: () => api<Methodology>("/methodology"),
    staleTime: 600_000,
  });

export const useStatus = () =>
  useQuery({
    queryKey: ["status"],
    queryFn: () => api<StatusResponse>("/status"),
    refetchInterval: 15_000,
  });
