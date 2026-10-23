import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";
import { Shell } from "./components/Shell";
import { RouteError } from "./components/RouteError";
import { PageLoading } from "./components/PageLoading";

const Home = lazy(() => import("./pages/Home"));
const Night = lazy(() => import("./pages/Night"));
const Nights = lazy(() => import("./pages/Nights"));
const Team = lazy(() => import("./pages/Team"));
const Teams = lazy(() => import("./pages/Teams"));
const Player = lazy(() => import("./pages/Player"));
const Game = lazy(() => import("./pages/Game"));
const TremorPage = lazy(() => import("./pages/Tremor"));
const Leaders = lazy(() => import("./pages/Leaders"));
const WhatIf = lazy(() => import("./pages/WhatIf"));
const Method = lazy(() => import("./pages/Method"));
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
      { path: "/teams", element: page(<Teams />) },
      { path: "/team/:abbrev", element: page(<Team />) },
      { path: "/player/:id", element: page(<Player />) },
      { path: "/game/:id", element: page(<Game />) },
      { path: "/tremor/:id", element: page(<TremorPage />) },
      { path: "/leaders", element: page(<Leaders />) },
      { path: "/what-if", element: page(<WhatIf />) },
      { path: "/method", element: page(<Method />) },
      { path: "/status", element: page(<Status />) },
      { path: "*", element: <RouteError notFound /> },
    ],
  },
]);
