import { Link, isRouteErrorResponse, useRouteError } from "react-router";

export function RouteError({ notFound = false }: { notFound?: boolean }) {
  const error = useRouteError();
  const missing = notFound || (isRouteErrorResponse(error) && error.status === 404);
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="display text-[38px] font-bold">
        {missing ? "Nothing here" : "This page broke"}
      </h1>
      <p className="mt-3 text-ink-soft">
        {missing
          ? "That address does not match any page. Tonight's map is always on the home page."
          : "Something failed while loading this page. Reload to try again, or head back to tonight's map."}
      </p>
      <Link
        to="/"
        className="mt-6 inline-block font-semibold text-blue-line underline underline-offset-4"
      >
        Back to tonight
      </Link>
    </div>
  );
}
