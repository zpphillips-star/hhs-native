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

