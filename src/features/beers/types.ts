export type Beer = {
  id: string;
  day_number: number;
  name: string;
  brewery: string;
  style: string | null;
  abv: number | null;
  description: string | null;
  brewery_fact: string | null;
  beer_fact: string | null;
  image_url: string | null;
  created_at: string;
};

export type BeerRating = {
  id: string;
  user_id: string;
  beer_id: string;
  stars: number;
  notes: string | null;
  created_at: string;
};

export type BeerRatingSummary = {
  average: number | null;
  count: number;
};

export type BeerWallActivity = {
  id: string;
  content: string;
  photo_url: string | null;
  created_at: string;
  author: string;
  reactionCount: number;
  commentCount: number;
};
