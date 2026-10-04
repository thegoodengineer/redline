import { Suspense } from "react";
import Studio from "@/components/Studio";

export const metadata = { title: "Redline studio" };

export default function StudioPage() {
  return (
    <Suspense>
      <Studio />
    </Suspense>
  );
}
