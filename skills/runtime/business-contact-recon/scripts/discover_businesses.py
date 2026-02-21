"""
Business Discovery Script
Uses DuckDuckGo and web searches to discover businesses by region/industry.
Free sources only - no paid APIs required.
"""

import requests
from bs4 import BeautifulSoup
import time
import json
import re
from urllib.parse import quote_plus, urlparse
from datetime import datetime
from typing import List, Dict, Optional


class BusinessDiscovery:
    """Discover businesses using free web sources."""
    
    def __init__(self, delay_seconds: float = 3.0):
        self.delay = delay_seconds
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
    
    def search_duckduckgo(self, query: str, max_results: int = 20) -> List[str]:
        """Search DuckDuckGo and return result URLs."""
        time.sleep(self.delay)
        
        url = f"https://duckduckgo.com/html/?q={quote_plus(query)}"
        response = self.session.get(url, timeout=30)
        
        if response.status_code != 200:
            print(f"Error: HTTP {response.status_code}")
            return []
        
        soup = BeautifulSoup(response.text, 'lxml')
        links = []
        
        for result in soup.select('.result__a')[:max_results]:
            href = result.get('href', '')
            if href and not href.startswith('/'):
                links.append(href)
        
        return links
    
    def extract_business_info(self, url: str) -> Optional[Dict]:
        """Extract basic business info from a URL."""
        try:
            time.sleep(1)  # Rate limiting
            response = self.session.get(url, timeout=15, allow_redirects=True)
            
            if response.status_code != 200:
                return None
            
            soup = BeautifulSoup(response.text, 'lxml')
            
            # Extract business name from title or h1
            title = soup.title.string if soup.title else ''
            h1 = soup.find('h1')
            business_name = h1.get_text(strip=True) if h1 else title.split('|')[0].split('-')[0].strip()
            
            # Extract website info
            parsed = urlparse(url)
            website = f"{parsed.scheme}://{parsed.netloc}"
            
            return {
                'url': url,
                'business_name': business_name,
                'website': website,
                'title_snippet': title[:100],
                'extracted_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            print(f"Error extracting {url}: {e}")
            return None
    
    def discover_by_region_industry(self, region: str, industry: str, 
                                   keywords: List[str] = None) -> List[Dict]:
        """
        Main discovery method for region + industry combinations.
        
        Args:
            region: City, state, or region (e.g., "Austin TX")
            industry: Industry type (e.g., "plumber", "restaurant")
            keywords: Additional keywords to include
        """
        if keywords is None:
            keywords = []
        
        results = []
        search_queries = [
            f"{industry} {region}",
            f"{industry} near {region}",
        ]
        
        # Add keyword variations
        for kw in keywords:
            search_queries.append(f"{kw} {industry} {region}")
            search_queries.append(f"{industry} {kw} {region}")
        
        # Dedupe queries
        search_queries = list(set(search_queries))
        
        for query in search_queries:
            print(f"Searching: {query}")
            urls = self.search_duckduckgo(query)
            
            for url in urls:
                info = self.extract_business_info(url)
                if info:
                    info['search_query'] = query
                    results.append(info)
        
        # Dedupe by URL
        seen = set()
        unique_results = []
        for r in results:
            if r['url'] not in seen:
                seen.add(r['url'])
                unique_results.append(r)
        
        print(f"\nFound {len(unique_results)} unique businesses")
        return unique_results
    
    def save_results(self, results: List[Dict], filepath: str = "discovered_businesses.json"):
        """Save results to JSON file."""
        with open(filepath, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"Saved to {filepath}")


def main():
    """Example usage."""
    discovery = BusinessDiscovery(delay_seconds=3.0)
    
    # Example: Find plumbers in Austin TX
    results = discovery.discover_by_region_industry(
        region="Austin, TX",
        industry="plumber",
        keywords=["emergency", "commercial"]
    )
    
    discovery.save_results(results)
    return results


if __name__ == "__main__":
    main()
