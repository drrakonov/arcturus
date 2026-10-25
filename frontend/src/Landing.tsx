import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowDown, Pause, Play } from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { Galaxy } from "./components/Galaxy";
import { apiUrl, wakeBackendEnabled } from "./client";
import { wakeBackend } from "./wakeBackend";
import "./landing.css";

gsap.registerPlugin(ScrollTrigger);

export default function Landing() {
    useEffect(() => {
        if (!wakeBackendEnabled) return;

        const controller = new AbortController();
        void wakeBackend(apiUrl, controller.signal).catch(() => {
            // The landing page stays usable even when trading services are unavailable.
        });

        return () => controller.abort();
    }, []);

    const root = useRef<HTMLDivElement>(null);
    const journey = useRef<HTMLElement>(null);
    const [paused, setPaused] = useState(false);
    const [reduced, setReduced] = useState(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    useEffect(() => {
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        const change = () => setReduced(query.matches);
        query.addEventListener("change", change);
        const media = gsap.matchMedia();
        media.add(
            "(prefers-reduced-motion: no-preference)",
            () => {
                gsap.from(".landing-reveal", {
                    y: 25,
                    opacity: 0,
                    duration: 1.1,
                    stagger: 0.12,
                    ease: "power3.out"
                });
            },
            root
        );
        return () => {
            query.removeEventListener("change", change);
            media.revert();
        };
    }, []);
    useEffect(() => {
        // Native scrolling remains available when motion is paused or reduced.
        if (reduced || paused) return;
        const lenis = new Lenis({ anchors: true, duration: 1.05, smoothWheel: true });
        const tick = (seconds: number) => lenis.raf(seconds * 1000);
        gsap.ticker.add(tick);
        return () => {
            gsap.ticker.remove(tick);
            lenis.destroy();
        };
    }, [reduced, paused]);
    useEffect(() => {
        if (paused || reduced) return;
        const context = gsap.context(() => {
            const timeline = gsap.timeline({
                scrollTrigger: {
                    trigger: journey.current,
                    start: "top top",
                    end: "bottom bottom",
                    scrub: 0.6
                }
            });
            timeline
                .to(
                    ".landing-hero, .galaxy-coordinate",
                    { autoAlpha: 0, y: -45, duration: 0.18 },
                    0.08
                )
                .fromTo(
                    ".journey-middle",
                    { autoAlpha: 0, y: 35 },
                    { autoAlpha: 1, y: 0, duration: 0.15 },
                    0.3
                )
                .to(".journey-middle", { autoAlpha: 0, y: -35, duration: 0.13 }, 0.61)
                .fromTo(
                    ".journey-arrival",
                    { autoAlpha: 0, y: 40 },
                    { autoAlpha: 1, y: 0, duration: 0.18 },
                    0.77
                )
                .to(".journey-progress i", { scaleX: 1, duration: 1, ease: "none" }, 0);
        }, root);
        return () => context.revert();
    }, [paused, reduced]);
    return (
        <div
            className={`landing ${paused || reduced ? "still-journey" : "animated-journey"}`}
            ref={root}
        >
            <a className="skip-link" href="#explore">
                Skip to content
            </a>
            <section className="journey" ref={journey} aria-label="Journey to the exchange">
                <div className="cosmos">
                    <Galaxy paused={paused || reduced} journey={journey} />
                    <div className="cosmos-shade" aria-hidden="true" />
                    <header className="landing-header">
                        <a className="brand" href="/" aria-label="Arcturus home">
                            <span className="brand-mark">✳</span>
                            <span>ARCTURUS</span>
                        </a>
                        <nav aria-label="Main navigation">
                            <a href="#experience">The experience</a>
                            <a className="nav-trade" href="/trade">
                                Launch terminal <ArrowUpRight size={15} />
                            </a>
                        </nav>
                    </header>
                    <main className="landing-hero" id="explore">
                        <div className="landing-reveal hero-eyebrow">
                            <span /> A DIFFERENT KIND OF TRADING SPACE
                        </div>
                        <h1 className="landing-reveal">
                            A market
                            <br />
                            of your <em>own.</em>
                        </h1>
                        <p className="landing-reveal hero-copy">
                            Explore the mechanics of a living market.
                            <br />
                            Place an order. Watch it match. See the whole picture.
                        </p>
                        <div className="landing-reveal hero-actions">
                            <a className="launch-button" href="/trade">
                                Enter the exchange <ArrowUpRight size={19} />
                            </a>
                            <span>
                                Virtual funds.
                                <br />
                                Real order matching.
                            </span>
                        </div>
                    </main>
                    <section
                        className="journey-copy journey-middle"
                        aria-label="Explore the market"
                    >
                        <span className="hero-eyebrow">02 / THROUGH THE CONSTELLATIONS</span>
                        <h2>
                            Every point.
                            <br />
                            <em>A possibility.</em>
                        </h2>
                        <p>
                            Follow the movement. Find your price.
                            <br />A living order book is waiting on the other side.
                        </p>
                        <div className="orbit-diagram" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                            <span>✳</span>
                        </div>
                    </section>
                    <section
                        className="journey-copy journey-arrival"
                        aria-label="Enter the exchange"
                    >
                        <span className="hero-eyebrow">03 / ARRIVAL</span>
                        <h2>
                            Step into
                            <br />
                            <em>the market.</em>
                        </h2>
                        <p>
                            100 virtual SOL. ₹1,00,000 to explore.
                            <br />
                            Your first trade starts with a price you choose.
                        </p>
                        <a className="launch-button" href="/trade">
                            Start trading <ArrowUpRight size={19} />
                        </a>
                        <small>Simulated assets. Actual order matching.</small>
                    </section>
                    <div className="galaxy-coordinate" aria-hidden="true">
                        <span className="coordinate-cross">+</span> ARCTURUS{" "}
                        <small>YOUR POINT OF DEPARTURE</small>
                    </div>
                    <div className="cosmos-bottom">
                        <a href="#experience">
                            Explore the terminal <ArrowDown size={14} />
                        </a>
                        <button
                            onClick={() => setPaused(!paused)}
                            disabled={reduced}
                            aria-pressed={paused || reduced}
                        >
                            {paused || reduced ? <Play size={12} /> : <Pause size={12} />}{" "}
                            {reduced ? "Reduced motion" : paused ? "Resume motion" : "Pause motion"}
                        </button>
                        <span className="journey-progress" aria-label="Journey progress">
                            <i />
                        </span>
                    </div>
                </div>
            </section>
            <section className="experience" id="experience" aria-labelledby="experience-title">
                <div className="experience-heading">
                    <span className="section-index">BUILT TO BE EXPLORED</span>
                    <h2 id="experience-title">
                        Every order has a story.
                        <br />
                        <span>Follow it from start to fill.</span>
                    </h2>
                    <p>
                        A working exchange demo, from the first price on the book to the balance in
                        your account.
                    </p>
                </div>
                <div className="experience-rows">
                    <div>
                        <span>01</span>
                        <h3>A market in motion</h3>
                        <p>
                            Live order book, execution-driven candles, and a trade tape that updates
                            as orders match.
                        </p>
                    </div>
                    <div>
                        <span>02</span>
                        <h3>Take your position</h3>
                        <p>
                            Start with ₹1,00,000 and 100 SOL in virtual balances. Place limit orders
                            and cancel unfilled quantities.
                        </p>
                    </div>
                    <div>
                        <span>03</span>
                        <h3>See what happens</h3>
                        <p>
                            Watch partial fills, price improvement, and reserved balances. Open a
                            second trader to try both sides.
                        </p>
                    </div>
                </div>
                <a className="experience-link" href="/trade">
                    Your first order starts here <ArrowUpRight size={22} />
                </a>
            </section>
            <footer className="landing-footer">
                <a href="/" className="brand">
                    ✳ ARCTURUS
                </a>
                <span>A simulated exchange. No deposits. No real-money trading.</span>
                <a href="/trade">Open terminal ↗</a>
            </footer>
        </div>
    );
}
