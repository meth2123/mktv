import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Star, Tv } from "lucide-react";
import {
  isFavoriteByStreamUrl,
  onFavoritesUpdated,
  toggleFavorite,
} from "../services/favorites.service";

export default function ChannelCard({ channel, streamUrl }) {
  const url = streamUrl
    ? `/watch?url=${encodeURIComponent(streamUrl)}`
    : `/watch?index=${channel?.id ?? 0}`;
  const effectiveStreamUrl = streamUrl || channel?.streamUrl || "";

  const logo = (channel?.tvgLogo || "").trim();
  // Some playlists contain local file paths like file:///S:/... which browsers will block.
  const safeLogo = logo.toLowerCase().startsWith("file:") ? "" : logo;
  const [isFav, setIsFav] = useState(() => isFavoriteByStreamUrl(effectiveStreamUrl));

  useEffect(() => {
    setIsFav(isFavoriteByStreamUrl(effectiveStreamUrl));
  }, [effectiveStreamUrl]);

  useEffect(() => {
    return onFavoritesUpdated(() => {
      setIsFav(isFavoriteByStreamUrl(effectiveStreamUrl));
    });
  }, [effectiveStreamUrl]);

  const favoritePayload = useMemo(
    () => ({
      id: channel?.id,
      name: channel?.name,
      groupTitle: channel?.groupTitle,
      tvgLogo: channel?.tvgLogo,
      streamUrl: effectiveStreamUrl,
      format: channel?.format,
    }),
    [
      channel?.format,
      channel?.groupTitle,
      channel?.id,
      channel?.name,
      channel?.tvgLogo,
      effectiveStreamUrl,
    ],
  );

  return (
    <Link
      to={url}
      className="card-prime block rounded-xl overflow-hidden bg-brand-800/70 border border-brand-700 hover:border-brand-500/60 w-full"
    >
      <div className="aspect-[16/10] bg-brand-950 flex items-center justify-center overflow-hidden relative">
        {effectiveStreamUrl ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const next = toggleFavorite(favoritePayload);
              setIsFav(next);
            }}
            className="absolute top-2 right-2 z-20 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/15 bg-black/45 hover:bg-black/65"
            title={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
            aria-label={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
          >
            <Star className={`w-4 h-4 ${isFav ? "text-amber-300 fill-amber-300" : "text-white/80"}`} />
          </button>
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
        {safeLogo ? (
          <img
            src={safeLogo}
            alt=""
            className="w-full h-full object-contain p-3 relative z-10"
            onError={(e) => {
              e.target.style.display = "none";
              e.target.nextSibling?.classList.remove("hidden");
            }}
          />
        ) : null}
        <Tv className={`w-12 h-12 text-brand-600 ${safeLogo ? "hidden" : ""} relative z-10`} />
      </div>
      <div className="p-3 bg-brand-900/20">
        <p className="font-semibold text-white text-sm truncate">{channel?.name || "Chaine"}</p>
        {channel?.groupTitle && <p className="text-xs text-gray-500 truncate">{channel.groupTitle}</p>}
      </div>
    </Link>
  );
}
