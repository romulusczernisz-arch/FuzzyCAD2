import { Suspense } from "react";
import FuzzyCADHome from "./FuzzyCADHome";

export default function Home() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Loading FuzzyCAD...</main>}>
      <FuzzyCADHome />
    </Suspense>
  );
}