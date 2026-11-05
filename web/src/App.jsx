import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Admin from "./pages/Admin.jsx";
import Custody from "./pages/Custody.jsx";
import Home from "./pages/Home.jsx";
import Manufacturer from "./pages/Manufacturer.jsx";
import NotFound from "./pages/NotFound.jsx";
import Regulator from "./pages/Regulator.jsx";
import Verify from "./pages/Verify.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="admin" element={<Admin />} />
        <Route path="manufacturer" element={<Manufacturer />} />
        <Route path="custody" element={<Custody />} />
        <Route path="regulator" element={<Regulator />} />
        <Route path="verify" element={<Verify />} />
        <Route path="verify/:id" element={<Verify />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
