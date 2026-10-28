import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Shell } from "./components/Shell";
import { RouteError } from "./components/RouteError";
import { PageLoading } from "./components/PageLoading";

const Home = lazy(() => import("./pages/Home"));
const Night = lazy(() => import("./pages/Night"));
const Nights = lazy(() => import("./pages/Nights"));
const Team = lazy(() => import("./pages/Team"));
const Standings = lazy(() => import("./pages/Standings"));
const Player = lazy(() => import("./pages/Player"));
const Game = lazy(() => import("./pages/Game"));
const TremorPage = lazy(() => import("./pages/Tremor"));
const Leaders = lazy(() => import("./pages/Leaders"));
const WhatIf = lazy(() => import("./pages/WhatIf"));
const RosterLab = lazy(() => import("./pages/RosterLab"));
const Method = lazy(() => import("./pages/Method"));
const About = lazy(() => import("./pages/About"));
const Status = lazy(() => import("./pages/Status"));
const Embed = lazy(() => import("./pages/Embed"));

function page(node: ReactNode) {
  return <Suspense fallback={<PageLoading label="Loading" />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  { path: "/embed/:abbrev", element: page(<Embed />) },
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: page(<Home />) },
      { path: "/nights", element: page(<Nights />) },
      { path: "/night/:date", element: page(<Night />) },
      { path: "/standings", element: page(<Standings />) },
      // The page was called Teams until 2026-10-24; old links keep working.
      { path: "/teams", element: <Navigate to="/standings" replace /> },
      { path: "/team/:abbrev", element: page(<Team />) },
      { path: "/player/:id", element: page(<Player />) },
      { path: "/game/:id", element: page(<Game />) },
      { path: "/tremor/:id", element: page(<TremorPage />) },
      { path: "/leaders", element: page(<Leaders />) },
      { path: "/what-if", element: page(<WhatIf />) },
      { path: "/roster-lab", element: page(<RosterLab />) },
      { path: "/method", element: page(<Method />) },
      { path: "/about", element: page(<About />) },
      { path: "/status", element: page(<Status />) },
      { path: "*", element: <RouteError notFound /> },
    ],
  },
]);
