import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import "./style.css";
import { ClickFeedback } from "./components/ClickFeedback";

const Terminal = lazy(() => import("./Terminal"));

const Landing = lazy(() => import("./Landing"));

const isTrading = window.location.pathname.replace(/\/$/, "") === "/trade";

document.title = isTrading ? "ARCTURUS — Spot terminal" : "ARCTURUS — A market of your own";

createRoot(document.getElementById("root")!).render(
    <>
        <ClickFeedback />
        <Suspense
            fallback={
                <div className="page-loading" role="status">
                    ✳ Loading ARCTURUS…
                </div>
            }
        >
            {isTrading ? <Terminal /> : <Landing />}
        </Suspense>
    </>
);
