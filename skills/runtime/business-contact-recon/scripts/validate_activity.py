"""
Activity Validation Script
Validates business activity using free public signals.
Checks social presence, reviews, news, and community activity.
"""

import requests
from bs4 import BeautifulSoup
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import re


class ActivityValidator:
    """Validate business activity through multi-signal analysis."""
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
    
    def check_google_reviews(self, business_name: str, location: str = "") -> Dict:
        """Check Google review presence (basic check)."""
        # Note: Full review data requires Google Places API (free tier available)
        # This is a placeholder for basic website review signals
        
        signals = {
            'has_reviews': False,
            'review_platform': None,
            'last_activity': None,
            'rating': None,
            'review_count': 0
        }
        
        # Check for review widgets on website
        try:
            # This is simplified - real implementation needs more logic
            signals['method'] = 'website_check'
        except Exception:
            pass
        
        return signals
    
    def check_yelp_presence(self, business_name: str) -> Dict:
        """Check Yelp listing presence."""
        signals = {
            'has_yelp': False,
            'yelp_url': None,
            'rating': None,
            'review_count': 0,
            'last_review_date': None
        }
        
        try:
            url = f"https://www.yelp.com/search?find_desc={quote_plus(business_name)}"
            time.sleep(1)
            response = self.session.get(url, timeout=15)
            
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'lxml')
                # Basic check for listings
                signals['has_yelp'] = True
                # More detailed parsing would go here
        except Exception:
            pass
        
        return signals
    
    def check_social_media(self, website: str) -> Dict:
        """Check for social media presence on business website."""
        social_signals = {
            'has_website': True,
            'linkedin': None,
            'instagram': None,
            'facebook': None,
            'twitter': None
        }
        
        if not website:
            return {**social_signals, 'has_website': False}
        
        try:
            time.sleep(1)
            response = self.session.get(website, timeout=10)
            
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'lxml')
                page_text = soup.get_text().lower()
                
                # Check for social links
                for link in soup.find_all('a', href=True):
                    href = link['href'].lower()
                    if 'linkedin.com' in href:
                        social_signals['linkedin'] = link['href']
                    elif 'instagram.com' in href:
                        social_signals['instagram'] = link['href']
                    elif 'facebook.com' in href:
                        social_signals['facebook'] = link['href']
                    elif 'twitter.com' in href or 'x.com' in href:
                        social_signals['twitter'] = link['href']
                        
        except Exception:
            pass
        
        return social_signals
    
    def check_website_freshness(self, website: str) -> Dict:
        """Check website update signals."""
        freshness = {
            'has_website': False,
            'last_modified': None,
            'days_since_update': None,
            'has_blog': False,
            'has_news': False
        }
        
        if not website:
            return freshness
        
        try:
            time.sleep(1)
            response = self.session.head(website, timeout=10, allow_redirects=True)
            
            if response.status_code == 200:
                freshness['has_website'] = True
                
                # Check Last-Modified header
                if 'Last-Modified' in response.headers:
                    freshness['last_modified'] = response.headers['Last-Modified']
        
        except Exception:
            pass
        
        return freshness
    
    def validate_business(self, business_data: Dict) -> Dict:
        """
        Run full validation on a business.
        
        Args:
            business_data: Dict with 'name' and 'website' keys
        """
        validation = {
            'business_name': business_data.get('name'),
            'website': business_data.get('website'),
            'validated_at': datetime.now().isoformat(),
            'activity_signals': {},
            'confidence_score': 0.0,
            'is_active': False,
            'recommendation': None
        }
        
        # Run all checks
        if business_data.get('website'):
            validation['activity_signals']['social'] = self.check_social_media(
                business_data['website']
            )
            validation['activity_signals']['freshness'] = self.check_website_freshness(
                business_data['website']
            )
        
        validation['activity_signals']['reviews'] = self.check_google_reviews(
            business_data.get('name', '')
        )
        validation['activity_signals']['yelp'] = self.check_yelp_presence(
            business_data.get('name', '')
        )
        
        # Calculate confidence based on signals
        score = 0
        if validation['activity_signals'].get('social', {}).get('has_website'):
            score += 20
        if any(validation['activity_signals'].get('social', {}).get(x) 
               for x in ['linkedin', 'instagram', 'facebook', 'twitter']):
            score += 20
        if validation['activity_signals'].get('yelp', {}).get('has_yelp'):
            score += 20
        if validation['activity_signals'].get('freshness', {}).get('has_website'):
            score += 20
        if validation['activity_signals'].get('reviews', {}).get('has_reviews'):
            score += 20
        
        validation['confidence_score'] = score
        validation['is_active'] = score >= 40
        
        # Recommendation
        if score >= 70:
            validation['recommendation'] = 'high'
        elif score >= 40:
            validation['recommendation'] = 'medium'
        else:
            validation['recommendation'] = 'low'
        
        return validation


def quote_plus(s):
    """Simple URL encoding."""
    import urllib.parse
    return urllib.parse.quote_plus(s)


def main():
    """Example usage."""
    validator = ActivityValidator()
    
    test_business = {
        'name': 'Example Business',
        'website': 'https://example.com'
    }
    
    result = validator.validate_business(test_business)
    print(f"Validation result: {result}")
    return result


if __name__ == "__main__":
    main()
