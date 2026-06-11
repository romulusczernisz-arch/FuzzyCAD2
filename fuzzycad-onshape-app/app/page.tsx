import { Suspense } from "react";
import FuzzyCADHome from "./fuzzycad-home";

export default function Home() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Loading FuzzyCAD...</main>}>
      <FuzzyCADHome />
    </Suspense>
  );
}